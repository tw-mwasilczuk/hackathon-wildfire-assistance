const fetch = require('node-fetch');
const { formatAddress } = require('./utils/addressFormatter');

async function generateAmadeusAccessToken() {
    console.log('\n--- Generating Amadeus Access Token ---');
    const details = {
        'grant_type': 'client_credentials',
        'client_id': process.env.AMADEUS_API_KEY,
        'client_secret': process.env.AMADEUS_AUTH_TOKEN
    };

    try {
        const response = await fetch("https://test.api.amadeus.com/v1/security/oauth2/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: Object.entries(details)
                .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
                .join('&')
        });

        if (!response.ok) {
            throw new Error(`Amadeus token request failed: ${response.status}`);
        }

        const data = await response.json();
        console.log('Token generated successfully!');
        return data.access_token;
    } catch (error) {
        console.error('Error generating Amadeus token:', error);
        throw error;
    }
}

async function findHotelRoom(functionArgs) {
    const cityName = functionArgs.cityName;
    try {
        console.log('\n--- Starting Hotel Room Search ---');
        console.log('Searching for hotels in:', cityName);
        
        // Format the address and geocode
        const formattedAddress = formatAddress(cityName);
        const API_KEY = process.env.GEO_CODING_API_KEY;
        const geocodeUrl = `https://geocode.maps.co/search?q=${encodeURIComponent(formattedAddress)}&api_key=${API_KEY}`;
        
        const geocodeResponse = await fetch(geocodeUrl);
        if (!geocodeResponse.ok) {
            return JSON.stringify({
                error: "I couldn't find that city. Could you please try again?"
            });
        }

        const geocodeData = await geocodeResponse.json();
        if (!geocodeData || geocodeData.length === 0) {
            return JSON.stringify({
                error: "I couldn't find that city. Could you please try again?"
            });
        }

        // Get coordinates and search for hotels
        const location = {
            lat: geocodeData[0].lat,
            lng: geocodeData[0].lon
        };
        console.log('Location found:', geocodeData[0].display_name);

        const accessToken = await generateAmadeusAccessToken();
        
        // Set up search dates
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const checkInDate = today.toISOString().split('T')[0];
        const checkOutDate = tomorrow.toISOString().split('T')[0];

        // Search for hotels in the area
        const hotelSearchUrl = `https://test.api.amadeus.com/v1/reference-data/locations/hotels/by-geocode?latitude=${location.lat}&longitude=${location.lng}&radius=5&radiusUnit=KM`;
        const hotelSearchResponse = await fetch(hotelSearchUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (!hotelSearchResponse.ok) {
            return JSON.stringify({
                error: "I'm having trouble finding hotels in that area. Please try again later."
            });
        }

        const hotelSearchData = await hotelSearchResponse.json();
        console.log(`Found ${hotelSearchData.data?.length || 0} hotels in the area`);

        if (!hotelSearchData.data || hotelSearchData.data.length === 0) {
            return JSON.stringify({
                error: `I couldn't find any hotels in ${cityName}. Would you like to try another city?`
            });
        }

        // Get hotel offers
        const hotelIds = hotelSearchData.data.slice(0, 10).map(hotel => hotel.hotelId).join(',');
        let hotelOffersUrl = `https://test.api.amadeus.com/v3/shopping/hotel-offers?hotelIds=${hotelIds}&checkInDate=${checkInDate}&checkOutDate=${checkOutDate}&adults=1&roomQuantity=1&paymentPolicy=NONE&includeClosed=false&bestRateOnly=true&sort=PRICE`;

        if (functionArgs.petFriendly) {
            hotelOffersUrl += `&amenities=PETS_ALLOWED`;
            console.log('Searching for pet-friendly hotels');
        }

        const hotelOffersResponse = await fetch(hotelOffersUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (!hotelOffersResponse.ok) {
            return JSON.stringify({
                error: "I'm having trouble finding hotel rooms right now. Please try again later."
            });
        }

        const hotelOffersData = await hotelOffersResponse.json();
        console.log(`Found ${hotelOffersData.data?.length || 0} available hotels`);
        
        if (hotelOffersData.data && hotelOffersData.data.length > 0) {
            const cheapestOffer = hotelOffersData.data[0];
            const offer = cheapestOffer.offers[0];
            
            // Get address using reverse geocoding
            const reverseGeocodeUrl = `https://geocode.maps.co/reverse?lat=${cheapestOffer.hotel.latitude}&lon=${cheapestOffer.hotel.longitude}&api_key=${API_KEY}`;
            const reverseGeocodeResponse = await fetch(reverseGeocodeUrl);
            let addressString = 'Address not available';
            
            if (reverseGeocodeResponse.ok) {
                const reverseGeocodeData = await reverseGeocodeResponse.json();
                if (reverseGeocodeData.address) {
                    const addr = reverseGeocodeData.address;
                    addressString = [
                        addr.house_number,
                        addr.road,
                        addr.city || addr.town || addr.suburb,
                        addr.state,
                        addr.postcode
                    ].filter(Boolean).join(', ');
                } else if (reverseGeocodeData.display_name) {
                    addressString = reverseGeocodeData.display_name;
                }
            }
            
            // Create the result object
            const result = {
                hotelName: cheapestOffer.hotel.name,
                address: addressString,
                price: `${offer.price.total} ${offer.price.currency}`,
                roomType: offer.room.type,
                bedType: offer.room.typeEstimated.bedType,
                checkIn: checkInDate,
                checkOut: checkOutDate,
                isPetFriendly: functionArgs.petFriendly && cheapestOffer.hotel
            };
            
            return JSON.stringify(result);
        } else {
            return JSON.stringify({
                error: `I couldn't find any available hotel rooms in ${cityName} for tonight. Would you like to try another city?`
            });
        }

    } catch (error) {
        console.error('Error in findHotelRoom:', error);
        return JSON.stringify({
            error: "I'm having trouble finding hotel rooms right now. Please try again later."
        });
    }
}

module.exports = findHotelRoom;
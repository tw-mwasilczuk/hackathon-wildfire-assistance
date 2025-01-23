const fetch = require('node-fetch');
const { formatAddress } = require('./utils/addressFormatter');

async function generateAmadeusAccessToken() {
    console.log('\n--- Generating Amadeus Access Token ---');
    const details = {
        'grant_type': 'client_credentials',
        'client_id': process.env.AMADEUS_API_KEY,
        'client_secret': process.env.AMADEUS_AUTH_TOKEN
    };

    console.log('API Key length:', process.env.AMADEUS_API_KEY?.length || 'undefined');
    console.log('Auth Token length:', process.env.AMADEUS_AUTH_TOKEN?.length || 'undefined');

    const formBody = Object.entries(details)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');

    console.log('Request body:', formBody);

    try {
        console.log('Making token request to Amadeus...');
        const response = await fetch("https://test.api.amadeus.com/v1/security/oauth2/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: formBody
        });

        console.log('Token Response Status:', response.status);
        console.log('Token Response Status Text:', response.statusText);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Token Error Response:', errorText);
            throw new Error(`Amadeus token request failed: ${response.status}`);
        }

        const data = await response.json();
        console.log('Token generated successfully!');
        console.log('Token type:', data.token_type);
        console.log('Token expires in:', data.expires_in, 'seconds');
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
        console.log('Input city:', cityName);
        
        // Format the address using the utility function
        const formattedAddress = formatAddress(cityName);
        console.log('Formatted address:', formattedAddress);
        
        // First, geocode the city using geocode.maps.co with API key
        console.log('\nMaking geocoding request...');
        const API_KEY = process.env.GEO_CODING_API_KEY;
        const geocodeUrl = `https://geocode.maps.co/search?q=${encodeURIComponent(formattedAddress)}&api_key=${API_KEY}`;
        console.log('Geocoding URL:', geocodeUrl.replace(API_KEY, 'HIDDEN'));
        
        const geocodeResponse = await fetch(geocodeUrl);
        
        console.log('Geocoding Response Status:', geocodeResponse.status);
        
        if (!geocodeResponse.ok) {
            const errorText = await geocodeResponse.text();
            console.error('Geocoding Error Response:', errorText);
            return JSON.stringify({
                error: "I couldn't find that city. Could you please try again?"
            });
        }

        const geocodeData = await geocodeResponse.json();
        console.log('Geocoding Results:', JSON.stringify(geocodeData, null, 2));

        if (!geocodeData || geocodeData.length === 0) {
            console.log('No geocoding results found');
            return JSON.stringify({
                error: "I couldn't find that city. Could you please try again?"
            });
        }

        // Get the first result's coordinates
        const location = {
            lat: geocodeData[0].lat,
            lng: geocodeData[0].lon
        };
        console.log('Selected coordinates:', location);

        // Get Amadeus access token
        console.log('\nGetting Amadeus access token...');
        const accessToken = await generateAmadeusAccessToken();
        console.log('Access token received (first 10 chars):', accessToken.substring(0, 10) + '...');

        // Get current date and tomorrow's date
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        const checkInDate = today.toISOString().split('T')[0];
        const checkOutDate = tomorrow.toISOString().split('T')[0];
        console.log('Search dates:', { checkInDate, checkOutDate });

        // First, get hotel locations from Amadeus
        console.log('\nSearching for hotels in the area...');
        const hotelSearchUrl = `https://test.api.amadeus.com/v1/reference-data/locations/hotels/by-geocode?` +
            `latitude=${location.lat}&longitude=${location.lng}` +
            `&radius=5&radiusUnit=KM`;
        
        console.log('Hotel search URL:', hotelSearchUrl);

        const hotelSearchResponse = await fetch(hotelSearchUrl, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        console.log('Hotel Search Response Status:', hotelSearchResponse.status);
        
        if (!hotelSearchResponse.ok) {
            const errorText = await hotelSearchResponse.text();
            console.error('Hotel Search Error Response:', errorText);
            return JSON.stringify({
                error: "I'm having trouble finding hotels in that area. Please try again later."
            });
        }

        const hotelSearchData = await hotelSearchResponse.json();
        console.log('Number of hotels found:', hotelSearchData.data?.length || 0);

        if (!hotelSearchData.data || hotelSearchData.data.length === 0) {
            return JSON.stringify({
                error: `I couldn't find any hotels in ${cityName}. Would you like to try another city?`
            });
        }

        // Get the first 10 hotel IDs (or less if fewer hotels found)
        const hotelIds = hotelSearchData.data
            .slice(0, 10)
            .map(hotel => hotel.hotelId)
            .join(',');

        // Now search for offers using these hotel IDs
        console.log('\nSearching for hotel offers...');
        const hotelOffersUrl = `https://test.api.amadeus.com/v3/shopping/hotel-offers?` + 
            `hotelIds=${hotelIds}` +
            `&checkInDate=${checkInDate}` +
            `&checkOutDate=${checkOutDate}` +
            `&adults=1` +
            `&roomQuantity=1` +
            `&paymentPolicy=NONE` +
            `&includeClosed=false` +
            `&bestRateOnly=true` +
            `&sort=PRICE`;
        
        console.log('Hotel offers URL:', hotelOffersUrl);

        const hotelOffersResponse = await fetch(hotelOffersUrl, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        console.log('Hotel Offers Response Status:', hotelOffersResponse.status);
        
        if (!hotelOffersResponse.ok) {
            const errorText = await hotelOffersResponse.text();
            console.error('Hotel Offers Error Response:', errorText);
            return JSON.stringify({
                error: "I'm having trouble finding hotel rooms right now. Please try again later."
            });
        }

        const hotelOffersData = await hotelOffersResponse.json();
        console.log('Number of hotels found:', hotelOffersData.data?.length || 0);
        
        // Return the cheapest available hotel offer if available
        if (hotelOffersData.data && hotelOffersData.data.length > 0) {
            const cheapestOffer = hotelOffersData.data[0];
            const offer = cheapestOffer.offers[0];
            
            console.log('Cheapest hotel data:', JSON.stringify(cheapestOffer.hotel, null, 2));
            console.log('Offer data:', JSON.stringify(offer, null, 2));

            // Get address using reverse geocoding
            const API_KEY = process.env.GEO_CODING_API_KEY;
            const reverseGeocodeUrl = `https://geocode.maps.co/reverse?lat=${cheapestOffer.hotel.latitude}&lon=${cheapestOffer.hotel.longitude}&api_key=${API_KEY}`;
            console.log('Reverse Geocoding URL:', reverseGeocodeUrl.replace(API_KEY, 'HIDDEN'));

            const reverseGeocodeResponse = await fetch(reverseGeocodeUrl);
            let addressString = 'Address not available';
            
            console.log('Reverse Geocoding Response Status:', reverseGeocodeResponse.status);
            
            if (!reverseGeocodeResponse.ok) {
                const errorText = await reverseGeocodeResponse.text();
                console.error('Reverse Geocoding Error Response:', errorText);
            } else {
                const reverseGeocodeData = await reverseGeocodeResponse.json();
                console.log('Reverse Geocoding Result:', JSON.stringify(reverseGeocodeData, null, 2));
                
                if (reverseGeocodeData.address) {
                    const addr = reverseGeocodeData.address;
                    console.log('Address components:', addr);
                    const addressParts = [
                        addr.house_number,
                        addr.road,
                        addr.city || addr.town || addr.suburb,
                        addr.state,
                        addr.postcode
                    ].filter(Boolean); // Remove any undefined/null values
                    
                    addressString = addressParts.join(', ');
                    console.log('Constructed address string:', addressString);
                } else if (reverseGeocodeData.display_name) {
                    addressString = reverseGeocodeData.display_name;
                    console.log('Using display_name as address:', addressString);
                }
            }
            
            console.log('Final address string before creating result:', addressString);
            
            // Move the return statement here, after addressString is set
            return JSON.stringify({
                hotelName: cheapestOffer.hotel.name,
                address: addressString,
                price: `${offer.price.total} ${offer.price.currency}`,
                roomType: offer.room.type || 'Standard Room',
                bedType: offer.room.typeEstimated?.bedType || 'Not specified',
                checkIn: checkInDate,
                checkOut: checkOutDate
            });
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
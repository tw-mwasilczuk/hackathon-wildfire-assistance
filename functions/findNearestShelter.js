const fetch = require('node-fetch');
const fs = require('fs');
const csv = require('csv-parse/sync');

// Helper function to calculate distance between two points using Haversine formula
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the Earth in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; // Distance in km
}

async function findNearestShelter(functionArgs) {
    const address = functionArgs.address;
    try {
        console.log('\n--- Starting Nearest Shelter Search ---');
        console.log('Input address:', address);
        
        // First, geocode the address using geocode.maps.co
        console.log('\nMaking geocoding request...');
        const API_KEY = process.env.GEO_CODING_API_KEY;
        const geocodeUrl = `https://geocode.maps.co/search?q=${encodeURIComponent(address)}&api_key=${API_KEY}`;
        console.log('Geocoding URL:', geocodeUrl.replace(API_KEY, 'HIDDEN'));
        
        const geocodeResponse = await fetch(geocodeUrl);
        
        console.log('Geocoding Response Status:', geocodeResponse.status);
        
        if (!geocodeResponse.ok) {
            const errorText = await geocodeResponse.text();
            console.error('Geocoding Error Response:', errorText);
            return JSON.stringify({
                error: "I couldn't find that address. Could you please try again with a different address?"
            });
        }

        const geocodeData = await geocodeResponse.json();
        console.log('Geocoding Results:', JSON.stringify(geocodeData, null, 2));

        if (!geocodeData || geocodeData.length === 0) {
            console.log('No geocoding results found');
            return JSON.stringify({
                error: "I couldn't find that address. Could you please try again with a different address?"
            });
        }

        // Get the first result's coordinates
        const userLocation = {
            lat: parseFloat(geocodeData[0].lat),
            lon: parseFloat(geocodeData[0].lon)
        };
        console.log('User coordinates:', userLocation);

        // Read and parse the CSV file
        console.log('\nReading shelter data...');
        const fileContent = fs.readFileSync('Homeless_Shelters_and_Services.csv', 'utf-8');
        const records = csv.parse(fileContent, {
            columns: true,
            skip_empty_lines: true
        });

        // Calculate distances and find the nearest shelter
        console.log('\nCalculating distances to shelters...');
        let nearestShelter = null;
        let shortestDistance = Infinity;

        records.forEach(shelter => {
            if (shelter.latitude && shelter.longitude) {
                const distance = calculateDistance(
                    userLocation.lat,
                    userLocation.lon,
                    parseFloat(shelter.latitude),
                    parseFloat(shelter.longitude)
                );

                if (distance < shortestDistance) {
                    shortestDistance = distance;
                    nearestShelter = shelter;
                }
            }
        });

        if (!nearestShelter) {
            return JSON.stringify({
                error: "I couldn't find any shelters in the database. Please try again later."
            });
        }

        // Format the distance
        const distanceMiles = (shortestDistance * 0.621371).toFixed(1); // Convert km to miles

        // Extract relevant information
        const result = {
            name: nearestShelter.Name || nearestShelter.org_name,
            address: nearestShelter.addrln1,
            city: nearestShelter.city,
            state: nearestShelter.state,
            zip: nearestShelter.zip,
            distance: `${distanceMiles} miles`,
            hours: nearestShelter.hours || "Hours not specified",
            phones: nearestShelter.phones || "Phone number not available",
            services: nearestShelter.description || "Service details not available",
            suggestAlternatives: parseFloat(distanceMiles) > 50 // Flag to indicate if we should suggest hotels
        };

        console.log('Nearest shelter found:', JSON.stringify(result, null, 2));
        return JSON.stringify(result);

    } catch (error) {
        console.error('Error in findNearestShelter:', error);
        return JSON.stringify({
            error: "I'm having trouble finding shelters right now. Please try again later."
        });
    }
}

module.exports = findNearestShelter; 
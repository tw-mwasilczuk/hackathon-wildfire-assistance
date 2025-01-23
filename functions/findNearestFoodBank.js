const fetch = require('node-fetch');
const fs = require('fs').promises;
const { formatAddress } = require('./utils/addressFormatter');

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c;
    return distance;
}

async function findNearestFoodBank(functionArgs) {
    try {
        const address = functionArgs.address;
        console.log('Finding nearest food bank to:', address);

        // First geocode the input address
        const API_KEY = process.env.GEO_CODING_API_KEY;
        const geocodeUrl = `https://geocode.maps.co/search?q=${encodeURIComponent(address)}&api_key=${API_KEY}`;
        
        const geocodeResponse = await fetch(geocodeUrl);
        if (!geocodeResponse.ok) {
            return JSON.stringify({
                error: "I couldn't find that address. Could you please try again?"
            });
        }

        const geocodeData = await geocodeResponse.json();
        if (!geocodeData || geocodeData.length === 0) {
            return JSON.stringify({
                error: "I couldn't find that address. Could you please try again?"
            });
        }

        const userLocation = {
            lat: parseFloat(geocodeData[0].lat),
            lon: parseFloat(geocodeData[0].lon)
        };

        // Load food banks data
        const foodBanksData = await fs.readFile('data/foodBanks.json', 'utf8');
        const foodBanks = JSON.parse(foodBanksData);

        // Find the nearest food bank
        let nearestBank = null;
        let shortestDistance = Infinity;

        for (const bank of foodBanks) {
            if (bank.coordinates) {
                const distance = calculateDistance(
                    userLocation.lat,
                    userLocation.lon,
                    parseFloat(bank.coordinates.lat),
                    parseFloat(bank.coordinates.lon)
                );

                if (distance < shortestDistance) {
                    shortestDistance = distance;
                    nearestBank = bank;
                }
            }
        }

        if (!nearestBank) {
            return JSON.stringify({
                error: "I couldn't find any food banks near that location."
            });
        }

        // Convert distance to miles for display
        const distanceMiles = (shortestDistance * 0.621371).toFixed(1);

        const result = {
            name: nearestBank.name,
            address: nearestBank.address,
            city: nearestBank.city,
            county: nearestBank.county,
            phone: nearestBank.phone,
            distance: `${distanceMiles} miles`,
            coordinates: nearestBank.coordinates
        };

        return JSON.stringify(result);

    } catch (error) {
        console.error('Error in findNearestFoodBank:', error);
        return JSON.stringify({
            error: "I'm having trouble finding food banks right now. Please try again later."
        });
    }
}

module.exports = findNearestFoodBank; 
const fetch = require('node-fetch');
const fs = require('fs');
const csv = require('csv-parse/sync');
const { formatAddress } = require('./addressFormatter');

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

async function findNearestAnimalShelter(functionArgs) {
    const address = functionArgs.address;
    const animalType = functionArgs.animalType?.toLowerCase() || 'small'; // Default to small animals if not specified
    
    try {
        console.log('\n--- Starting Animal Shelter Search ---');
        console.log('Input address:', address);
        console.log('Animal type:', animalType);
        
        // Format the address using the utility function
        const formattedAddress = formatAddress(address);
        console.log('Formatted address:', formattedAddress);

        // Add state if not present and city is San Francisco
        let addressesToTry = [formattedAddress];
        if (formattedAddress.toLowerCase().includes('san francisco') && !formattedAddress.toLowerCase().includes('ca')) {
            addressesToTry.push(formattedAddress + ', CA');
        }
        
        // Try each address format until we get a result
        let geocodeData = null;
        let geocodeResponse = null;
        
        for (const addressToTry of addressesToTry) {
            console.log('\nTrying address:', addressToTry);
            const API_KEY = process.env.GEO_CODING_API_KEY;
            const geocodeUrl = `https://geocode.maps.co/search?q=${encodeURIComponent(addressToTry)}&api_key=${API_KEY}`;
            console.log('Geocoding URL:', geocodeUrl.replace(API_KEY, 'HIDDEN'));
            
            geocodeResponse = await fetch(geocodeUrl);
            console.log('Geocoding Response Status:', geocodeResponse.status);
            
            if (geocodeResponse.ok) {
                const data = await geocodeResponse.json();
                if (data && data.length > 0) {
                    geocodeData = data;
                    console.log('Successfully geocoded with:', addressToTry);
                    break;
                }
            }
            
            // Wait a bit before trying the next format to respect rate limits
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        if (!geocodeResponse?.ok) {
            const errorText = await geocodeResponse.text();
            console.error('Geocoding Error Response:', errorText);
            return JSON.stringify({
                error: "I couldn't find that address. Could you please try again with a different address? Make sure to include the city and state (e.g., '123 Main St, San Francisco, CA')."
            });
        }

        if (!geocodeData || geocodeData.length === 0) {
            console.log('No geocoding results found');
            return JSON.stringify({
                error: "I couldn't find that address. Could you please try again with a different address? Make sure to include the city and state (e.g., '123 Main St, San Francisco, CA')."
            });
        }

        // Get the first result's coordinates
        const userLocation = {
            lat: parseFloat(geocodeData[0].lat),
            lon: parseFloat(geocodeData[0].lon)
        };
        console.log('User coordinates:', userLocation);

        // Read and parse the CSV file
        console.log('\nReading animal shelter data...');
        const fileContent = fs.readFileSync('Animal_Shelters.csv', 'utf-8');
        const records = csv.parse(fileContent, {
            columns: true,
            skip_empty_lines: true
        });

        // Filter shelters based on animal type
        const eligibleShelters = records.filter(shelter => {
            if (animalType === 'large') {
                return shelter.type === 'Large Animals' || shelter.type === 'Both';
            } else {
                return shelter.type === 'Small Animals' || shelter.type === 'Both';
            }
        });

        if (eligibleShelters.length === 0) {
            return JSON.stringify({
                error: `I couldn't find any shelters that accept ${animalType} animals in our database.`
            });
        }

        // Calculate distances for all eligible shelters
        console.log('\nCalculating distances to shelters...');
        const sheltersWithDistances = eligibleShelters
            .filter(shelter => shelter.latitude && shelter.longitude)
            .map(shelter => ({
                ...shelter,
                distance: calculateDistance(
                    userLocation.lat,
                    userLocation.lon,
                    parseFloat(shelter.latitude),
                    parseFloat(shelter.longitude)
                )
            }))
            .sort((a, b) => a.distance - b.distance);

        if (sheltersWithDistances.length === 0) {
            return JSON.stringify({
                error: `I couldn't find any available shelters that accept ${animalType} animals in our database.`
            });
        }

        // Get the nearest shelter and check if it's at capacity
        const nearestShelter = sheltersWithDistances[0];
        const isAtCapacity = nearestShelter.notes && nearestShelter.notes.toLowerCase().includes('at capacity');
        
        // Get the next nearest shelter if available
        const nextNearestShelter = isAtCapacity && sheltersWithDistances.length > 1 ? 
            sheltersWithDistances[1] : null;

        // Format the distances
        const distanceMiles = (nearestShelter.distance * 0.621371).toFixed(1);
        const nextDistanceMiles = nextNearestShelter ? 
            (nextNearestShelter.distance * 0.621371).toFixed(1) : null;

        // Extract relevant information
        const result = {
            name: nearestShelter.name,
            address: nearestShelter.address,
            city: nearestShelter.city,
            state: nearestShelter.state,
            zip: nearestShelter.zip || '',
            distance: `${distanceMiles} miles`,
            type: nearestShelter.type,
            notes: nearestShelter.notes || '',
            isAtCapacity: isAtCapacity,
            suggestAlternatives: parseFloat(distanceMiles) > 50,
            alternativeSuggestion: parseFloat(distanceMiles) > 50 ? 
                `Since this shelter is quite far, I can help you find temporary accommodation nearby that accepts pets. Would you like me to search for pet-friendly hotels in your area?` : '',
            nextNearest: nextNearestShelter ? {
                name: nextNearestShelter.name,
                address: nextNearestShelter.address,
                city: nextNearestShelter.city,
                state: nextNearestShelter.state,
                zip: nextNearestShelter.zip || '',
                distance: `${nextDistanceMiles} miles`,
                type: nextNearestShelter.type,
                notes: nextNearestShelter.notes || ''
            } : null
        };

        console.log('Shelter results:', JSON.stringify(result, null, 2));
        return JSON.stringify(result);

    } catch (error) {
        console.error('Error in findNearestAnimalShelter:', error);
        return JSON.stringify({
            error: "I'm having trouble finding animal shelters right now. Please try again later."
        });
    }
}

module.exports = findNearestAnimalShelter; 
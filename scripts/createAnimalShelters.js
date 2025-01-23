require('dotenv').config();
const fs = require('fs');
const fetch = require('node-fetch');

const shelters = [
    // Small Animals
    {
        name: "El Camino High School",
        address: "5440 Valley Circle Boulevard",
        city: "Woodland Hills",
        state: "CA",
        zip: "91367",
        type: "Small Animals",
        notes: "American Red Cross Sheltering Site with mobile animal shelter (small animals only)"
    },
    {
        name: "Baldwin Park Animal Care Center",
        address: "4275 Elton St",
        city: "Baldwin Park",
        state: "CA",
        type: "Small Animals"
    },
    {
        name: "Carson Animal Care Center",
        address: "216 West Victoria Street",
        city: "Gardena",
        state: "CA",
        zip: "90248",
        type: "Small Animals"
    },
    {
        name: "Downey Animal Care Center",
        address: "11258 Garfield Ave",
        city: "Downey",
        state: "CA",
        type: "Small Animals"
    },
    {
        name: "Lancaster Animal Care Center",
        address: "5210 W Ave I",
        city: "Lancaster",
        state: "CA",
        type: "Both",
        notes: "Accepts both small and large animals"
    },
    {
        name: "Palmdale Animal Care Center",
        address: "38550 Sierra Hwy",
        city: "Palmdale",
        state: "CA",
        type: "Small Animals"
    },
    {
        name: "Pasadena Humane",
        address: "361 S Raymond Ave",
        city: "Pasadena",
        state: "CA",
        type: "Small Animals",
        notes: "Only accepts small animals within its jurisdiction"
    },
    {
        name: "Agoura Animal Care Center",
        address: "29525 Agoura Rd",
        city: "Agoura Hills",
        state: "CA",
        type: "Small Animals"
    },
    {
        name: "Castaic Animal Care Center",
        address: "31044 Charlie Canyon",
        city: "Castaic",
        state: "CA",
        type: "Both",
        notes: "Accepts both small and large animals"
    },
    // Large Animals
    {
        name: "Industry Hills Expo",
        address: "16200 Temple Ave",
        city: "City of Industry",
        state: "CA",
        type: "Large Animals",
        notes: "Capacity for 200 horses; not staffed by DACC"
    },
    {
        name: "Pomona Fairplex",
        address: "1101 W Mckinley Ave",
        city: "Pomona",
        state: "CA",
        type: "Large Animals",
        notes: "Receiving horses and dogs (temporary kennels)"
    },
    {
        name: "Pierce College",
        address: "6201 Winnetka Ave",
        city: "Woodland Hills",
        state: "CA",
        type: "Large Animals"
    },
    {
        name: "LA Equestrian",
        address: "480 Riverside Dr",
        city: "Burbank",
        state: "CA",
        type: "Large Animals",
        notes: "At Capacity as of 1.12.25"
    },
    {
        name: "Hansen Dam Horse Park",
        address: "11127 Orcas Avenue",
        city: "Lake View Terrace",
        state: "CA",
        zip: "91342",
        type: "Large Animals"
    },
    {
        name: "Pico Rivera Sports Arena",
        address: "11003 Sports Arena Drive",
        city: "Pico Rivera",
        state: "CA",
        zip: "90601",
        type: "Large Animals"
    }
];

async function geocodeWithRetry(url, maxRetries = 3, initialDelay = 1500) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            // Always wait at least 1.5s between requests
            if (i > 0) {
                await new Promise(resolve => setTimeout(resolve, initialDelay));
            }
            
            const response = await fetch(url);
            if (response.ok) {
                return await response.json();
            }
            if (response.status === 429) {
                const delay = 1500 * (i + 1); // Linear backoff: 1.5s, 3s, 4.5s
                console.log(`Rate limited. Waiting ${delay/1000} seconds before retry ${i + 1}/${maxRetries}...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            throw new Error(`HTTP error! status: ${response.status}`);
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            console.log(`Attempt ${i + 1} failed, retrying...`);
        }
    }
    throw new Error('Max retries reached');
}

async function geocodeAddress(shelter) {
    // Manual coordinates for locations that fail to geocode
    const manualCoordinates = {
        "El Camino High School": {
            latitude: "34.169613448533354",
            longitude: "-118.64304795975328"
        },
        "Carson Animal Care Center": {
            latitude: "33.86439880837066",
            longitude: "-118.27741409045352"
        }
    };

    // Check if we have manual coordinates for this shelter
    if (manualCoordinates[shelter.name]) {
        console.log('Using manual coordinates for:', shelter.name);
        return {
            ...shelter,
            ...manualCoordinates[shelter.name]
        };
    }

    // Special case handling for problematic addresses
    let addressToTry = shelter.address;
    if (shelter.name === "El Camino High School") {
        addressToTry = addressToTry.replace("Boulevard", "Blvd");
    } else if (shelter.name === "Carson Animal Care Center") {
        addressToTry = addressToTry.replace("West", "W");
    } else if (shelter.name === "Pico Rivera Sports Arena") {
        addressToTry = "11003 Rooks Road"; // Alternative address for the same location
    }
    
    const addressWithZip = shelter.zip ? 
        `${addressToTry}, ${shelter.city}, ${shelter.state} ${shelter.zip}` :
        `${addressToTry}, ${shelter.city}, ${shelter.state}`;
    
    console.log('Trying to geocode:', addressWithZip);
    
    const API_KEY = process.env.GEO_CODING_API_KEY;
    const url = `https://geocode.maps.co/search?q=${encodeURIComponent(addressWithZip)}&api_key=${API_KEY}`;
    
    try {
        const data = await geocodeWithRetry(url);
        if (data && data.length > 0) {
            console.log('Successfully geocoded:', addressWithZip);
            return {
                ...shelter,
                latitude: data[0].lat,
                longitude: data[0].lon
            };
        }
        
        // If no results with ZIP, wait 2 seconds before trying without ZIP
        if (shelter.zip) {
            console.log('Retrying without ZIP code...');
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const addressWithoutZip = `${addressToTry}, ${shelter.city}, ${shelter.state}`;
            const retryUrl = `https://geocode.maps.co/search?q=${encodeURIComponent(addressWithoutZip)}&api_key=${API_KEY}`;
            
            const retryData = await geocodeWithRetry(retryUrl);
            if (retryData && retryData.length > 0) {
                console.log('Successfully geocoded without ZIP:', addressWithoutZip);
                return {
                    ...shelter,
                    latitude: retryData[0].lat,
                    longitude: retryData[0].lon
                };
            }
        }
        
        console.log('No geocoding results found for:', addressWithZip);
        return shelter;
    } catch (error) {
        console.error('Error geocoding:', error);
        return shelter;
    }
}

async function processAndSaveShelters() {
    console.log('Starting to geocode addresses...');
    
    const geocodedShelters = [];
    for (const shelter of shelters) {
        console.log(`\nProcessing: ${shelter.name}`);
        const geocodedShelter = await geocodeAddress(shelter);
        geocodedShelters.push(geocodedShelter);
        // Wait 1.5 seconds between processing different shelters
        await new Promise(resolve => setTimeout(resolve, 1500));
    }
    
    const headers = ['name', 'address', 'city', 'state', 'zip', 'type', 'notes', 'latitude', 'longitude'];
    const csvContent = [
        headers.join(','),
        ...geocodedShelters.map(shelter => 
            headers.map(header => 
                shelter[header] ? `"${shelter[header]}"` : ''
            ).join(',')
        )
    ].join('\n');
    
    fs.writeFileSync('Animal_Shelters.csv', csvContent);
    console.log('\nCSV file has been created successfully!');
    
    const successCount = geocodedShelters.filter(s => s.latitude && s.longitude).length;
    const failCount = geocodedShelters.length - successCount;
    console.log(`\nGeocoding Summary:`);
    console.log(`Successfully geocoded: ${successCount} addresses`);
    console.log(`Failed to geocode: ${failCount} addresses`);
    
    if (failCount > 0) {
        console.log('\nFailed addresses:');
        geocodedShelters
            .filter(s => !s.latitude || !s.longitude)
            .forEach(s => console.log(`- ${s.name}: ${s.address}, ${s.city}, ${s.state}${s.zip ? ' ' + s.zip : ''}`));
    }
}

processAndSaveShelters().catch(console.error); 
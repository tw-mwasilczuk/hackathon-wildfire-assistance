const fetch = require('node-fetch');
const fs = require('fs').promises;
require('dotenv').config();

// Track the last API call time
let lastCallTime = 0;

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForRateLimit() {
    const now = Date.now();
    const timeSinceLastCall = now - lastCallTime;
    if (timeSinceLastCall < 1100) { // Wait 1.1s to be safe
        const waitTime = 1100 - timeSinceLastCall;
        console.log(`Rate limit: waiting ${waitTime}ms`);
        await delay(waitTime);
    }
    lastCallTime = Date.now();
}

async function geocodeAddress(address, city, retries = 3) {
    const API_KEY = process.env.GEO_CODING_API_KEY;
    
    // Try different address formats
    const addressFormats = [
        `${address}, ${city}, CA`,  // Standard format
        `${address}, ${city}, California`,  // Full state name
        `${address}, ${city}`,  // Without state
        encodeURIComponent(address).replace(/%20/g, '+') + ',+' + city + ',+CA'  // URL-encoded with plus signs
    ];
    
    for (const addressFormat of addressFormats) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                await waitForRateLimit();
                
                const url = `https://geocode.maps.co/search?q=${encodeURIComponent(addressFormat)}&api_key=${API_KEY}`;
                console.log(`Attempt ${attempt}/${retries} format "${addressFormat}"`);
                
                const response = await fetch(url);
                
                if (response.status === 429) {
                    console.log('Rate limit hit, waiting 2 seconds...');
                    await delay(2000);
                    continue;
                }
                
                if (!response.ok) {
                    throw new Error(`Geocoding failed: ${response.status}`);
                }
                
                const data = await response.json();
                if (data && data.length > 0) {
                    console.log(`✓ Successfully geocoded with format: ${addressFormat}`);
                    return {
                        lat: data[0].lat,
                        lon: data[0].lon
                    };
                }
                
                console.log(`No results found for format: ${addressFormat}`);
                break; // Try next format if this one returns no results
                
            } catch (error) {
                console.error(`Error geocoding ${addressFormat} (attempt ${attempt}/${retries}):`, error);
                if (attempt === retries) {
                    break; // Try next format if all attempts for this format fail
                }
                await delay(1000 * attempt); // Exponential backoff
            }
        }
    }
    
    return null; // Return null if all formats fail
}

async function processFoodBanks() {
    const rawData = `
    Alameda County
    Alameda County Community Food Bank
    7900 Edgewater Drive
    Oakland
    510-635-3663

    Orange County
    Second Harvest Food Bank of Orange County
    8014 Marine Way
    Irvine
    949-653-2900

    Community Action Partnership of Orange County
    11870 Monarch Street
    Garden Grove
    714-897-6670

    Alpine County
    Food Bank of El Dorado County
    4550 Business Drive
    Cameron Park
    530-621-9950

    Placer County
    Placer Food Bank
    8284 Industrial Avenue
    Roseville
    916-783-0481

    Amador County
    Interfaith Council of Amador County
    12181 Airport Road
    Jackson
    209-267-9006

    Riverside County
    Second Harvest Food Bank
    2950-B Jefferson Street
    Riverside
    951-359-4757

    Butte County
    Community Action Agency of Butte County
    2640 S. Fifth Avenue, Suite 7
    Oroville
    530-538-7559

    Sacramento County
    Sacramento Food Bank and Family Services
    3333 3rd Ave.
    Sacramento
    916-456-1980

    Calaveras County
    Resource Connection
    206 George Reed Drive
    San Andreas
    209-754-1257

    San Benito County
    The Community Food Bank of San Benito County
    1133 San Felipe Road
    Hollister
    831-637-0340

    Contra Costa County
    Food Bank of Contra Costa & Solano
    4010 Nelson Avenue
    Concord
    925-676-7543

    San Bernardino County
    Community Action Partnership of San Bernardino County
    696 S. Tippecanoe Avenue
    San Bernardino
    909-723-1500

    Del Norte County
    Rural Human Services, Inc.
    286 M Street Suite A
    Crescent City
    707-464-7441

    San Diego County
    San Diego Food Bank
    9850 Distribution Avenue
    San Diego
    858-527-1419

    El Dorado County
    Food Bank of El Dorado County
    4550 Business Drive
    Cameron Park
    530-621-9950

    San Francisco County
    San Francisco Food Bank
    900 Pennsylvania Avenue
    San Francisco
    415-282-1907

    Fresno County
    Central California Food Bank
    4010 E Amendola Dr
    Fresno
    559-237-3663

    San Joaquin County
    San Joaquin County Human Services Agency
    2736 North Teepee Dr, Suite C
    Stockton
    209-468-0982

    Humboldt County
    Food For People, Inc.
    307 West 14th Street
    Eureka
    707-445-3166

    San Luis Obispo County
    Food Bank Coalition of San Luis Obispo County
    1180 Kendall Rd
    San Luis Obispo
    805-238-4664

    Imperial County
    Imperial Valley Food Bank
    329 Applestill Road
    El Centro
    760-370-0966

    San Mateo County
    Second Harvest Food Bank of Silicon Valley
    750 Curtner Avenue
    San Jose
    408-266-8866

    Inyo County
    Inyo/Mono Advocates For Community Action
    137 East South Street
    Bishop
    760-873-8557

    Santa Barbara County
    Food Bank of Santa Barbara
    4554 Hollister
    Santa Barbara
    805-967-5741

    Kern County
    Community Action Partnership of Kern
    5005 Business Park N
    Bakersfield
    661-336-5236

    Santa Clara County
    Second Harvest Food Bank of Silicon Valley
    750 Curtner Avenue
    San Jose
    408-266-8866

    Kings County
    Kings County Community Action Organization
    1130 North 11th Avenue
    Hanford
    559-582-4386

    Santa Cruz County
    Second Harvest Food Bank Serving Santa Cruz
    800 Ohlone Parkway
    Watsonville
    831-722-7110

    Lake County
    Clearlake Gleaners, Inc.
    1896 Big Valley Road
    Finley
    707-263-8082

    Shasta County
    Dignity Health Connected Living
    100 Mercy Oaks Drive
    Redding
    530-226-3060

    Siskiyou County
    Great Northern Corporation
    310 Boles Street
    Weed
    530-938-4115

    Los Angeles County
    Food Bank of Southern California
    1444 San Francisco Avenue
    Long Beach
    562-435-3577

    Los Angeles Regional Food Bank
    1734 East 41st Street
    Los Angeles
    323-234-3030

    Solano County
    Food Bank of Contra Costa & Solano
    4010 Nelson Avenue
    Concord
    925-676-7543

    Madera County
    Madera County Food Bank
    225 South Pine Street, Suite 101
    Madera
    559-674-1482

    Sonoma County
    Redwood Empire Food Bank
    3990 Brickway Blvd.
    Santa Rosa
    707-523-7900

    Marin County
    SF-Marin Food Bank
    75 Digital Drive
    Novato
    415-883-1302

    Stanislaus County
    Salvation Army Modesto Citadel
    600 Janopaul Way
    Modesto
    209-522-3209

    Mariposa County
    Merced County Food Bank, Inc
    2000 West Olive
    Merced
    209-726-3663

    Sutter County
    Yuba/Sutter Gleaners Food Bank, Inc.
    760 Stafford Way
    Yuba City
    530-673-3834

    Mendocino County
    fortbraggfoodbank.org
    910 North Franklin
    Fort Bragg
    707-964-9404

    Tehama County
    Tehama County Gleaners
    20699 Walnut Street
    Red Bluff
    530-529-2264

    Merced County
    Merced County Food Bank, Inc
    2000 West Olive
    Merced
    209-726-3663

    Trinity County
    Trinity County Food Assistance Program
    9069 3rd Street
    Weaverville
    530-623-5409

    Tulare County
    Foodlink for Tulare County
    611 2nd St
    Exeter
    559-651-3663

    Mono County
    Inyo/Mono Advocates For Community Action
    137 East South Street
    Bishop
    760-873-8557

    Tuolumne County
    Amador/Tuolumne Community Action Agency, Inc.
    10590 State Hwy 88
    Jackson
    209-223-1485

    Monterey County
    Food Bank for Monterey County
    353 W Rossi St
    Salinas
    831-758-1523

    Ventura County
    Food Share Inc. of Ventura County
    4156 North Southbank Road
    Oxnard
    805-983-7100

    Napa County
    Community Action of Napa Valley
    2521 Old Sonoma Rd
    Napa
    707-253-6100

    Yolo County
    Food Bank of Yolo County
    233 Harter Ave
    Woodland
    530-668-0690

    Nevada County
    Food Bank of Nevada County
    310 Railroad Ave #100
    Grass Valley
    530-272-3796

    Yuba County
    Yuba/Sutter Gleaners Food Bank, Inc.
    760 Stafford Way
    Yuba City
    530-673-3834
    `;

    const foodBanks = [];
    let currentBank = null;

    // Split the raw data into lines and process each line
    const lines = rawData.trim().split('\n').map(line => line.trim()).filter(line => line);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (line.includes('County')) {
            // Start a new food bank entry
            if (currentBank && currentBank.name) {
                foodBanks.push(currentBank);
            }
            currentBank = {
                county: line.replace(' County', '')
            };
        } else if (currentBank) {
            // Check if this is a new food bank within the same county
            if (currentBank.phone && !currentBank.isProcessed) {
                foodBanks.push(currentBank);
                currentBank = {
                    county: currentBank.county
                };
            }

            if (!currentBank.name) {
                currentBank.name = line;
            } else if (!currentBank.address) {
                currentBank.address = line;
            } else if (!currentBank.city) {
                currentBank.city = line;
            } else if (!currentBank.phone) {
                currentBank.phone = line;
                
                // Complete entry, geocode and add to list
                console.log(`\nProcessing: ${currentBank.name}`);
                console.log(`Geocoding: ${currentBank.address}, ${currentBank.city}, CA`);
                
                const coords = await geocodeAddress(currentBank.address, currentBank.city);
                if (coords) {
                    currentBank.coordinates = coords;
                    console.log('Success ✓');
                } else {
                    console.log('Failed to geocode ✗');
                }
                
                currentBank.isProcessed = true;
            }
        }
    }

    // Add the last bank if it exists
    if (currentBank && currentBank.name && !currentBank.isProcessed) {
        foodBanks.push(currentBank);
    }

    // Count successes and failures
    const successfulGeocodes = foodBanks.filter(bank => bank.coordinates).length;
    const failedGeocodes = foodBanks.filter(bank => !bank.coordinates).length;

    // Save to file
    await fs.writeFile(
        'data/foodBanks.json', 
        JSON.stringify(foodBanks, null, 2)
    );

    console.log('\n=== Processing Complete ===');
    console.log(`Total food banks processed: ${foodBanks.length}`);
    console.log(`Successfully geocoded: ${successfulGeocodes}`);
    console.log(`Failed to geocode: ${failedGeocodes}`);
    
    if (failedGeocodes > 0) {
        console.log('\nFailed addresses:');
        foodBanks.forEach(bank => {
            if (!bank.coordinates) {
                console.log(`- ${bank.name}: ${bank.address}, ${bank.city}, CA`);
            }
        });
    }
    
    return foodBanks;
}

// Create data directory if it doesn't exist
fs.mkdir('data').catch(() => {});

// Run the script
processFoodBanks().catch(console.error); 
processFoodBanks().catch(console.error); 
require('dotenv').config();
const axios = require('axios');

async function geocodeAddress(params) {
    const API_KEY = process.env.GEO_CODING_API_KEY;
    const BASE_URL = 'https://geocode.maps.co/search';

    // If a full query string is provided, use it directly
    if (params.query) {
        const url = `${BASE_URL}?q=${encodeURIComponent(params.query)}&api_key=${API_KEY}`;
        try {
            const response = await axios.get(url);
            return response.data;
        } catch (error) {
            console.error('Error geocoding address:', error.message);
            throw error;
        }
    }

    // Otherwise, build the query from individual parameters
    const queryParams = new URLSearchParams({
        api_key: API_KEY
    });

    // Add available parameters
    if (params.street) queryParams.append('street', params.street);
    if (params.city) queryParams.append('city', params.city);
    if (params.county) queryParams.append('county', params.county);
    if (params.state) queryParams.append('state', params.state);
    if (params.country) queryParams.append('country', params.country);
    if (params.postalcode) queryParams.append('postalcode', params.postalcode);

    try {
        const url = `${BASE_URL}?${queryParams.toString()}`;
        const response = await axios.get(url);
        return response.data;
    } catch (error) {
        console.error('Error geocoding address:', error.message);
        throw error;
    }
}

// Parse command line arguments
function parseArgs() {
    const args = process.argv.slice(2);
    const params = {};

    // Check if the first argument is --query
    if (args[0] === '--query') {
        params.query = args[1];
        return params;
    }

    // Parse named parameters
    for (let i = 0; i < args.length; i += 2) {
        const key = args[i].replace('--', '');
        const value = args[i + 1];
        if (value) {
            params[key] = value;
        }
    }
    return params;
}

// Main function
async function main() {
    try {
        const params = parseArgs();
        if (Object.keys(params).length === 0) {
            console.log(`
Usage:
    1. Search by full query:
       node geocodeAddress.js --query "Statue of Liberty NY US"

    2. Search by parameters:
       node geocodeAddress.js --street "555 5th Ave" --city "New York" --state "NY" --postalcode "10017" --country "US"

Parameters:
    --query      Full search query
    --street     Street address
    --city       City name
    --county     County name
    --state      State name
    --country    Country name
    --postalcode Postal code
`);
            return;
        }

        console.log('Searching with parameters:', params);
        const result = await geocodeAddress(params);
        console.log(JSON.stringify(result, null, 2));

    } catch (error) {
        console.error('Error:', error.message);
    }
}

// Run the examples if this file is run directly
if (require.main === module) {
    main();
}

module.exports = geocodeAddress;
const Airtable = require('airtable');
require('dotenv').config();


const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

async function getLatestRecord() {
    try {
        let records = await base('builder').select({
            maxRecords: 1,
            sort: [{field: 'Updated', direction: 'desc'}]
        }).firstPage();
        
        if (records.length === 0) {
            throw new Error('No records found');
        }

        let record = records[0];
        // console.log('getLatestRecord: ', record)
        return {
            sys_prompt: record.get('Prompt') || '',
            profile: record.get('User Profile') || '',
            orders: record.get('Orders') || '',
            inventory: record.get('Inventory') || '',
            example: record.get('Example') || '',
            model: record.get('Model') || '',
            language: record.get('Language') || 'en-US',
            changeSTT: record.get('SPIChangeSTT') || false,
            recording: record.get('Recording') || false,
            transcriptionProvider: record.get('transcriptionProvider') || 'google',
            voice: record.get('Voice') || ''
        };
    } catch (error) {
        console.error('Error fetching record:', error);
        throw error;
    }
}



module.exports = { base, getLatestRecord };

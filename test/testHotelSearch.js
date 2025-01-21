require('dotenv').config();
const findHotelRoom = require('../functions/findHotelRoom');

async function testHotelSearch() {
    try {
        console.log('Testing hotel search for Pasadena...');
        
        const result = await findHotelRoom({ cityName: 'Pasadena' });
        
        console.log('\nResult:');
        console.log('Success:', result.success);
        console.log('Message:', result.message);
        
        if (result.success && result.data) {
            console.log('\nHotel Details:');
            console.log('------------------');
            console.log('Hotel:', result.data.hotelName);
            console.log('Address:', result.data.address);
            console.log('Price:', `${result.data.price.amount} ${result.data.price.currency}`);
            console.log('Room Type:', result.data.roomType);
            console.log('Bed Type:', result.data.bedType);
            console.log('Check-in:', result.data.checkIn);
            console.log('Check-out:', result.data.checkOut);
        }
        
    } catch (error) {
        console.error('Test failed with error:', error);
    }
}

// Run the test
testHotelSearch(); 
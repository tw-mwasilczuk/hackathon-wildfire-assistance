require('dotenv').config();
const twilio = require('twilio');

async function sendSMS(functionArgs) {
    try {
        const { phoneNumber, messageBody } = functionArgs;
        
        // Validate Twilio credentials
        if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.FROM_NUMBER) {
            throw new Error('Missing Twilio credentials in environment variables');
        }

        // Log credentials (first few chars only)
        console.log('Twilio Account SID (first 6 chars):', process.env.TWILIO_ACCOUNT_SID.substring(0, 6));
        console.log('Twilio Auth Token exists:', !!process.env.TWILIO_AUTH_TOKEN);
        console.log('From Number:', process.env.FROM_NUMBER);
        
        // Initialize Twilio client
        const client = twilio(
            process.env.TWILIO_ACCOUNT_SID,
            process.env.TWILIO_AUTH_TOKEN
        );

        console.log('Sending SMS to:', phoneNumber);
        console.log('Message:', messageBody);

        // Send the message
        const message = await client.messages.create({
            body: messageBody,
            to: phoneNumber,
            from: process.env.FROM_NUMBER
        });

        console.log('SMS sent successfully. SID:', message.sid);
        
        return JSON.stringify({
            success: true,
            message: "SMS sent successfully",
            sid: message.sid
        });

    } catch (error) {
        console.error('Error sending SMS:', error.message);
        return JSON.stringify({
            success: false,
            error: error.message || "Failed to send SMS. Please try again."
        });
    }
}

module.exports = sendSMS; 
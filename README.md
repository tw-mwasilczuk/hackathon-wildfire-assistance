# Wildfire Emergency Assistance AI

An AI-powered emergency assistance system designed to help people affected by wildfires in California. The system provides real-time assistance for finding emergency accommodation, shelters, and other critical services.

## Features

- Real-time emergency accommodation search
- Nearest shelter location services
- SMS notifications with important information
- Natural conversation interface
- Multi-language support
- Emergency service referrals

## Technical Stack

- Node.js
- OpenAI GPT-4
- Twilio for SMS
- Amadeus for Hotel Search
- Geocoding Services

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file with required credentials:
   ```
   OPENAI_API_KEY=your_key
   TWILIO_ACCOUNT_SID=your_sid
   TWILIO_AUTH_TOKEN=your_token
   FROM_NUMBER=your_twilio_number
   GEO_CODING_API_KEY=your_key
   ```
4. Start the application:
   ```bash
   npm run dev
   ```

## Environment Variables

- `OPENAI_API_KEY`: OpenAI API key
- `TWILIO_ACCOUNT_SID`: Twilio Account SID
- `TWILIO_AUTH_TOKEN`: Twilio Auth Token
- `FROM_NUMBER`: Twilio phone number
- `GEO_CODING_API_KEY`: Geocoding API key

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

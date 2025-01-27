require('dotenv').config();
require('colors');
require('log-timestamp');

// Validate required environment variables
const requiredEnvVars = [
  'SERVER',
  'OPENAI_API_KEY',
  'AIRTABLE_API_KEY',
  'WRITE_KEY',
  'GEO_CODING_API_KEY',
  'PROFILE_TOKEN',
  'SPACE_ID'
];

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
if (missingEnvVars.length > 0) {
  console.error('Error: Missing required environment variables:'.red);
  missingEnvVars.forEach(envVar => console.error(`- ${envVar}`.red));
  process.exit(1);
}

const express = require('express');
const ExpressWs = require('express-ws');

const { GptService } = require('./services/gpt-service');
const { TextService } = require('./services/text-service');
const { recordingService } = require('./services/recording-service');

const { prompt, userProfile, orderHistory } = require('./services/prompt');

const { getLatestRecord } = require('./services/airtable-service');
const { upsertUser, getProfileTraits, addEvent } = require('./services/segment-service');

const app = express();
ExpressWs(app);

const PORT = process.env.PORT || 3000;

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.url} ${res.statusCode} ${duration}ms`.cyan);
    addLog('request', `${req.method} ${req.url} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// Parse JSON bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Declare global variable
let gptService;
let textService;
let record;
global.currentUserId = null; // Add global user ID tracking

app.get('/monitor', (req, res) => {
  res.sendFile(__dirname + '/monitor.html');
});

// Initialize an array to store logs
const logs = [];

// Method to add logs
function addLog(level, message) {
    console.log(message);
    const timestamp = new Date().toISOString();
    logs.push({ timestamp, level, message });
}

// Route to retrieve logs
app.get('/logs', (req, res) => {
    res.json(logs);
});


app.post('/incoming', async (req, res) => {
  try {
    logs.length = 0; // Clear logs
    addLog('info', 'incoming call started');
    
    // Get latest record from airtable
    record = await getLatestRecord();
    // console.log('Get latest record ', record);

    // Initialize GPT service 
    gptService = new GptService(record.model);
    
    gptService.userContext.push({ 'role': 'system', 'content': record.sys_prompt });
    gptService.userContext.push({ 'role': 'system', 'content': record.profile });
    gptService.userContext.push({ 'role': 'system', 'content': record.orders });
    gptService.userContext.push({ 'role': 'system', 'content': record.inventory });
    gptService.userContext.push({ 'role': 'system', 'content': record.example });
    gptService.userContext.push({ 'role': 'system', 'content': `You can speak in many languages, but use default language ${record.language} for this conversation from now on! Remember it as the default language, even you change language in between. treat en-US and en-GB etc. as different languages.`});
    

    addLog('info', `language : ${record.language}, voice : ${record.voice}`);
    
    const response = 
    `<Response>
      <Connect>
        <ConversationRelay url="wss://${process.env.SERVER}/sockets" dtmfDetection="true" voice="${record.voice}" language="${record.language}" transcriptionProvider="${record.transcriptionProvider}" speechRate="1.2">
          <Language code="fr-FR" ttsProvider="google" voice="fr-FR-Neural2-B" />
          <Language code="es-ES" ttsProvider="google" voice="es-ES-Neural2-B" />
          <Voice name="en-US-Neural2-F" provider="google" style="empathetic" />
        </ConversationRelay>
      </Connect>
    </Response>`;
    res.type('text/xml');
    res.end(response.toString());
  } catch (err) {
    console.log(err);
  }
});

app.ws('/sockets', (ws) => {
  try {
    ws.on('error', console.error);
    // Filled in from start message
    let callSid;

    textService = new TextService(ws);

    let interactionCount = 0;
    
    // Incoming from MediaStream
    ws.on('message', async function message(data) {
      const msg = JSON.parse(data);
      console.log(msg);
      if (msg.type === 'setup') {
        addLog('convrelay', `convrelay socket setup ${msg.callSid}`);
        callSid = msg.callSid;        
        
        // Set phone number in GptService first
        gptService.setCallInfo('user phone number', msg.from);
        global.currentUserId = msg.from;
        let greetingSent = false;

        try {
          // Get existing profile traits
          const userProfile = await getProfileTraits(msg.from);
          console.log('getProfileTraits: ', userProfile);
          
          // Update user in Segment with phone number only on initial connection
          await upsertUser({ 
            userId: msg.from,
            anonymousId: msg.callSid,
            traits: { 
              phoneNumber: msg.from
            }
          });

          // Track call initiation
          await addEvent({
            userId: msg.from,
            event: 'Call Initiated',
            properties: {
              callSid: msg.callSid,
              timestamp: new Date().toISOString()
            }
          });

          // Add existing user info to context if available
          if (userProfile) {
            // Use first_name consistently
            const firstName = userProfile.first_name || userProfile.First_Name;
            if (firstName) {
              // Update to consistent casing if needed
              if (userProfile.First_Name && !userProfile.first_name) {
                await upsertUser({
                  userId: msg.from,
                  traits: {
                    first_name: firstName
                  }
                });
              }
              gptService.userContext.push({
                'role': 'system',
                'content': `The user's name is ${firstName}. Always address them by name in a friendly manner.`
              });
            }
            
            // Use caller_address consistently
            const address = userProfile.caller_address || userProfile.address || userProfile.Address;
            if (address) {
              // Update to consistent key if needed
              if ((userProfile.address || userProfile.Address) && !userProfile.caller_address) {
                await upsertUser({
                  userId: msg.from,
                  traits: {
                    caller_address: address,
                    address_updated_at: new Date().toISOString()
                  }
                });
              }
              gptService.setCallInfo('user address', address);
              console.log('Found existing address:', address);
              gptService.userContext.push({ 
                'role': 'system', 
                'content': `The user has a previously stored address: "${address}". Start by asking if they are still at this location.`
              });
            }
          }

          // Customize greeting based on available information
          let greeting;
          if (userProfile?.first_name || userProfile?.First_Name) {
            const name = userProfile.first_name || userProfile.First_Name;
            greeting = `Hello ${name}, I'm here to assist you during this challenging time. `;
            if (userProfile.caller_address || userProfile.address || userProfile.Address) {
              const address = userProfile.caller_address || userProfile.address || userProfile.Address;
              greeting += `Are you still at ${address}?`;
            } else {
              greeting += `Could you please confirm your current location?`;
            }
          } else {
            greeting = `Hello, I'm here to assist you during this challenging time. First, could you please tell me your name and current location?`;
          }
          
          gptService.completion(greeting, interactionCount);
          interactionCount += 1;
          greetingSent = true;

        } catch (error) {
          console.error('Error in setup sequence:', error);
          if (!greetingSent) {
            gptService.completion('Hello, I\'m here to assist you during this challenging time. Could you please tell me your name and current location?', interactionCount);
            interactionCount += 1;
          }
        }

        if(record.recording){
          recordingService(textService, callSid).then(() => {
            console.log(`Twilio -> Starting recording for ${callSid}`.underline.red);
          });
        }
      }  
      
      if (msg.type === 'prompt') {
        if (msg.last) {
          addLog('convrelay', `convrelay -> GPT (${msg.lang}) :  ${msg.voicePrompt} `);
          
          // Enhanced name and address extraction
          try {
            const input = msg.voicePrompt.toLowerCase();
            
            // Check for name in format "My name is [Name]" or similar patterns
            const namePatterns = [
                // Explicit spelled out name patterns - must start with clear name indicators
                /^(?:my )?first name is ([a-z]\s+[a-z]\s+[a-z]\s+[a-z]\s+[a-z])(?:\s*,?\s*(?:and|last name is)\s+([a-z]\s+[a-z]\s+[a-z]\s+[a-z]\s+[a-z]\s+[a-z]\s+[a-z]\s+[a-z]\s+[a-z]))?/i,
                // Regular name patterns - must have clear name indicators
                /^(?:my name is|i am|this is|i'm|call me) ([^,.]+?)(?:\s+and|[,.]|$)/i,
                /^([^,.]+?) (?:here|speaking)(?:\s+and|[,.]|$)/i
            ];
            
            let firstName, lastName;
            let foundName = false;
            
            for (const pattern of namePatterns) {
                const match = input.match(pattern);
                if (match) {
                    if (pattern.toString().includes('first name is')) {
                        // Handle spelled out names
                        firstName = match[1].replace(/\s+/g, '').toUpperCase();
                        if (match[2]) {
                            lastName = match[2].replace(/\s+/g, '').toUpperCase();
                        }
                        foundName = true;
                    } else {
                        // Handle regular names
                        const fullName = match[1].trim();
                        // Skip if the "name" looks like a location or action phrase
                        if (/(?:at|in|to|going|gonna|traveling|with)\s+/i.test(fullName.toLowerCase())) {
                            continue;
                        }
                        const nameParts = fullName.split(' ');
                        firstName = nameParts[0].charAt(0).toUpperCase() + nameParts[0].slice(1).toLowerCase();
                        if (nameParts.length > 1) {
                            lastName = nameParts.slice(1).map(word => 
                                word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
                            ).join(' ');
                        }
                        foundName = true;
                    }
                    break;
                }
            }
            
            // Update profile if name found
            if (foundName) {
                const traits = {};
                if (firstName) traits.first_name = firstName;
                if (lastName) traits.last_name = lastName;
                
                console.log('Updating user profile with name:', traits);
                await upsertUser({
                    userId: global.currentUserId,  // Use the stored userId
                    traits: traits
                });
                
                const displayName = firstName + (lastName ? ' ' + lastName : '');
                console.log('Updated user profile:', displayName);
            }
          } catch (error) {
            console.error('Error processing user input:', error);
          }

          gptService.completion(msg.voicePrompt, interactionCount);
          interactionCount += 1;
        }
      } 
      
      if (msg.type === 'interrupt') {
        addLog('convrelay', 'convrelay interrupt: utteranceUntilInterrupt: ' + msg.utteranceUntilInterrupt + ' durationUntilInterruptMs: ' + msg.durationUntilInterruptMs);
        gptService.interrupt();
        return; // Add this to prevent processing interrupted speech as new input
      }

      if (msg.type === 'error') {
        addLog('convrelay', 'convrelay error: ' + msg.description);
        
        console.log('Todo: add error handling');
      }

      if (msg.type === 'dtmf') {
        addLog('convrelay', 'convrelay dtmf: ' + msg.digit);
        
        console.log('Todo: add dtmf handling');
      }
    });
      
    gptService.on('gptreply', async (gptReply, final, icount) => {
      console.log(`Interaction ${icount}: GPT -> TTS: ${gptReply}`.green );
      //addLog('info', gptReply);
      addLog('gpt', `GPT -> convrelay: Interaction ${icount}: ${gptReply}`);
      textService.sendText(gptReply, final);
    });

    gptService.on('tools', async (functionName, functionArgs, functionResponse) => {
      
      addLog('gpt', `Function ${functionName} with args ${functionArgs}`);
      addLog('gpt', `Function Response: ${functionResponse}`);

      if(functionName == 'changeLanguage' && record.changeSTT){ 
        addLog('convrelay', `convrelay ChangeLanguage to: ${functionArgs}`);
        try {
          let jsonObj = JSON.parse(functionArgs);
          textService.setLang(jsonObj.language);
        } catch (error) {
          addLog('error', `Failed to parse language change arguments: ${error}`);
          console.error('Language change error:', error);
        }
      }
    });
  } catch (error) {
    console.error('Error in setup sequence:', error);
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:'.red, err);
  addLog('error', `Server error: ${err.message}`);
  res.status(500).send('Internal Server Error');
});

// Handle 404s
app.use((req, res) => {
  console.log('404 Not Found:'.yellow, req.url);
  res.status(404).send('Not Found');
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`.green);
  console.log(`WebSocket server is ready`.green);
  console.log(`Monitor available at http://localhost:${PORT}/monitor`.green);
});
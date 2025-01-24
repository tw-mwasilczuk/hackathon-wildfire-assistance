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
        <ConversationRelay url="wss://${process.env.SERVER}/sockets" dtmfDetection="true" voice="${record.voice}" language="${record.language}" transcriptionProvider="${record.transcriptionProvider}">
          <Language code="fr-FR" ttsProvider="google" voice="fr-FR-Neural2-B" />
          <Language code="es-ES" ttsProvider="google" voice="es-ES-Neural2-B" />
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
        gptService.setCallInfo('user phone number', msg.from);
        global.currentUserId = msg.from;
        let greetingSent = false;

        try {
          const userProfile = await getProfileTraits(msg.from);
          console.log('getProfileTraits: ', userProfile);
          
          await upsertUser({ 
            userId: msg.from,
            anonymousId: msg.callSid,
            traits: { 
              phoneNumber: msg.from,
              ...userProfile
            }
          });

          await addEvent({
            userId: msg.from,
            event: 'Call Initiated',
            properties: {
              callSid: msg.callSid,
              timestamp: new Date().toISOString()
            }
          });

          if (userProfile) {
            const name = userProfile.First_Name || userProfile.first_name;
            if (name) {
              gptService.userContext.push({
                'role': 'system',
                'content': `The user's name is ${name}. Always address them by name in a friendly manner.`
              });
            }
            
            if (userProfile.address) {
              gptService.setCallInfo('user address', userProfile.address);
              console.log('Found existing address:', userProfile.address);
              gptService.userContext.push({ 
                'role': 'system', 
                'content': `The user has a previously stored address: "${userProfile.address}". Start by asking if they are still at this location.`
              });
            }
          }

          // Customize greeting based on available information
          let greeting;
          if (userProfile?.First_Name) {
            greeting = `Hello ${userProfile.First_Name}, I'm here to assist you during this challenging time. `;
            if (userProfile.address) {
              greeting += `Are you still at ${userProfile.address}?`;
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
              /(?:my name is|i am|this is|i'm|call me) ([^,.]+)/i,
              /([^,.]+) (?:here|speaking)/i
            ];
            
            let firstName, lastName;
            for (const pattern of namePatterns) {
              const match = input.match(pattern);
              if (match) {
                const fullName = match[1].trim().split(' ');
                firstName = fullName[0].charAt(0).toUpperCase() + fullName[0].slice(1);
                if (fullName.length > 1) {
                  lastName = fullName.slice(1).map(word => 
                    word.charAt(0).toUpperCase() + word.slice(1)
                  ).join(' ');
                }
                break;
              }
            }

            // Check for address patterns
            const addressPatterns = [
              /(?:i(?:'|a)m at|i(?:'|a)m in|at|located at|address is|staying at) ([^.]+)/i,
              /([0-9]+[^,.]+(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr)[^,.]*)/i,
              /([^,.]+(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr)[^,.]*)/i
            ];

            let address;
            for (const pattern of addressPatterns) {
              const match = input.match(pattern);
              if (match) {
                address = match[1].trim();
                // Capitalize first letter of each word in address
                address = address.split(' ').map(word => 
                  word.charAt(0).toUpperCase() + word.slice(1)
                ).join(' ');
                break;
              }
            }

            // Update user profile if we found new information
            if ((firstName || address) && global.currentUserId) {
              const updateTraits = {
                userId: global.currentUserId,
                anonymousId: msg.callSid,
                traits: {
                  phoneNumber: global.currentUserId
                }
              };

              if (firstName) {
                updateTraits.traits.first_name = firstName;
                if (lastName) {
                  updateTraits.traits.last_name = lastName;
                }
                
                // Add name to GPT context for personalized responses
                gptService.userContext.push({
                  'role': 'system',
                  'content': `The user's name is ${firstName}${lastName ? ' ' + lastName : ''}. Address them by their first name in responses.`
                });
              }

              if (address) {
                updateTraits.traits.address = address;
                updateTraits.traits.address_updated_at = new Date().toISOString();
                
                // Add address to GPT context for location-based services
                gptService.setCallInfo('user address', address);
              }

              try {
                await upsertUser(updateTraits);
                console.log('Updated user profile:', updateTraits.traits);

                // Track profile update
                await addEvent({
                  userId: global.currentUserId,
                  event: 'Profile Updated',
                  properties: {
                    updated_fields: Object.keys(updateTraits.traits),
                    timestamp: new Date().toISOString()
                  }
                });
              } catch (error) {
                console.error('Error updating user profile:', error);
              }
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
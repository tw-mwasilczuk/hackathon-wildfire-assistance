require('colors');
const EventEmitter = require('events');
const OpenAI = require('openai');
const tools = require('../functions/utils/function-manifest');
const { prompt, userProfile } = require('./prompt');

// Import all functions included in function manifest
// Note: the function name and file name must be the same
const availableFunctions = {};

tools.forEach((tool) => {
  let functionName = tool.function.name;
  availableFunctions[functionName] = require(`../functions/utils/${functionName}`);
  console.log(`load function: ${functionName}`);
});

class GptService extends EventEmitter {
  constructor(model = 'gpt-4o') {
    super();
    this.openai = new OpenAI();
    this.model = model;  // Initialize model here
    this.userContext = [
      { 'role': 'system', 'content': prompt },
      { 'role': 'system', 'content': userProfile },
      { 'role': 'assistant', 'content': 'How can I help you today?' },
      { 'role': 'system', 'content': 'Keep responses brief and focused, ideally 1-2 short sentences. Wait for the user to finish speaking before providing detailed information.' },
    ];
    this.partialResponseIndex = 0;
    this.isInterrupted = false;
    this.lastHotelSearch = 0;
    this.lastShelterSearch = 0;
    this.searchCooldown = 2000; // 2 seconds cooldown
    this.lastUserInput = ''; // Store the last user input
    this.lastInputTime = 0; // Store the timestamp of the last input
    this.inputTimeout = 1000; // Wait 1 second for more input
    this.userId = null; // Store the user's phone number as their ID

    console.log(`GptService init with model: ${this.model}`);
  }

  setCallInfo(info, value) {
    console.log('setCallInfo', info, value);
    if (info === 'user phone number') {
      this.userId = value; // Store the phone number when it's set
      console.log('Set userId to:', this.userId); // Add logging
    }
    this.userContext.push({ 'role': 'user', 'content': `${info}: ${value}` });
  }

  interrupt() {
    this.isInterrupted = true;
  }

  validateFunctionArgs(args) {
    let argsArray = `[${args}]`
    try {
      return JSON.parse(argsArray);
    } catch (error) {
      const regex = /\}(?!\s*,)(?=.*\})/g;
      argsArray = argsArray.replace(regex, '},')
      try {
        return JSON.parse(argsArray);
      } catch (error) {
        console.log("error parsing function arguments.")
        return null;
      }
    }
  }

  updateUserContext(name, role, text) {
    if (name !== 'user') {
      this.userContext.push({ 'role': 'function', 'name': name, 'content': text });
    } else {
      this.userContext.push({ 'role': role, 'content': text });
    }
  }

  async completion(text, interactionCount, role = 'user', name = 'user') {
    console.log('GptService completion: ', role, name, text);
    
    // If this is user input, check if we should wait for more
    if (role === 'user' && name === 'user') {
      const now = Date.now();
      
      // If this is a continuation within the timeout window, accumulate it
      if (now - this.lastInputTime < this.inputTimeout) {
        this.lastUserInput += ' ' + text;
        this.lastInputTime = now;
        console.log('Accumulating input:', this.lastUserInput);
        return; // Wait for more potential input
      }
      
      // If we have accumulated input, use that instead
      if (this.lastUserInput) {
        text = this.lastUserInput + ' ' + text;
        console.log('Using accumulated input:', text);
      }
      
      // Reset for next time
      this.lastUserInput = '';
      this.lastInputTime = now;
    }

    this.isInterrupted = false;
    this.updateUserContext(name, role, text);

    // Update user info in Segment when provided
    if (role === 'user' && this.userId) {
      let traits = {};
      let shouldUpdate = false;

      // Check for name updates first
      const namePatterns = [
        // Must start with explicit name indicators and have a name after
        /(?:^|\s)(?:my name is|i am|i'm|this is|call me)\s+([a-z]+(?:\s+[a-z]+)?)\b(?:\s*[,.]|$)/i,
        // Must have "name" in the pattern and a name after
        /(?:^|\s)my\s+(?:first\s+)?name\s+(?:is\s+)?([a-z]+(?:\s+[a-z]+)?)\b(?:\s*[,.]|$)/i,
        // Must be an explicit introduction with a name
        /(?:^|\s)(?:hello|hi)(?:\s*,)?\s+(?:my name is|i am|i'm|this is)\s+([a-z]+(?:\s+[a-z]+)?)\b(?:\s*[,.]|$)/i
      ];

      for (const pattern of namePatterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          // Skip common false positives
          const nameParts = match[1].toLowerCase().split(/\s+/);
          const firstName = nameParts[0];
          
          // Skip if the first name is a common word we want to ignore
          if (['here', 'going', 'trying', 'looking', 'calling', 'at', 'in', 'to', 'is'].includes(firstName)) {
            continue;
          }
          
          // Format the first name - use first_name instead of First_Name
          traits.first_name = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
          
          // If there's a second part, check if it's a valid last name
          if (nameParts[1]) {
            // Skip if the second word looks like a preposition or verb
            if (!['to', 'for', 'at', 'in', 'on', 'with', 'by', 'from', 'is'].includes(nameParts[1])) {
              traits.last_name = nameParts[1].charAt(0).toUpperCase() + nameParts[1].slice(1).toLowerCase();
            }
          }
          
          shouldUpdate = true;
          console.log('Found name update:', traits);
          break;
        }
      }

      // And update the initial greeting check to use the correct case
      if (role === 'user' && name === 'user' && text.startsWith('Hello')) {
        // Skip address updates for system-generated greetings
        if (text.includes('Are you still at')) {
          console.log('Skipping address update for system greeting');
          shouldUpdate = false;  // Don't update address for system greeting
        } else {
          const existingAddress = traits.caller_address || '';  // Use caller_address instead
          if (existingAddress) {
            console.log('Found existing address:', existingAddress);
          }
        }
      }

      // Check for address updates
      const addressPatterns = [
        // Match numbered streets like "First Street"
        /(?:my address is|i'?m at|at|,)?\s*([0-9]+\s+(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|south|north|east|west)?\s*[^,.]*?(?:avenue|ave|street|st|road|rd|lane|ln|drive|dr|circle|cir|court|ct|boulevard|blvd|way|parkway|pkwy))/i,
        /([0-9]+\s+(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|south|north|east|west)?\s*[^,.]*?(?:avenue|ave|street|st|road|rd|lane|ln|drive|dr|circle|cir|court|ct|boulevard|blvd|way|parkway|pkwy))/i
      ];

      console.log('=== Checking Address Update ===');
      console.log('Input text:', text);
      console.log('Accumulated input:', this.lastUserInput);

      // Try with accumulated input first
      const combinedInput = this.lastUserInput ? `${this.lastUserInput} ${text}` : text;
      console.log('Combined input:', combinedInput);

      for (const pattern of addressPatterns) {
        console.log('Trying pattern:', pattern);
        const match = combinedInput.match(pattern);
        if (match) {
          // Skip address updates for system-generated messages
          if (combinedInput.startsWith('Hello') && combinedInput.includes('Are you still at')) {
            console.log('Skipping address update - system greeting message');
            continue;
          }

          console.log('Found address match:', match);
          let newAddress = match[1].trim();
          console.log('Extracted address:', newAddress);
          
          // Look for city/state after the street address
          const locationMatch = combinedInput.match(/(?:in|,)?\s*([^,.]+?)(?:\s*,\s*([^,.]+))?$/i);
          console.log('Location match:', locationMatch);
          
          if (locationMatch) {
            const city = locationMatch[1].trim();
            console.log('Found city:', city);
            // Only use city if it's not the same as the street
            if (!newAddress.includes(city)) {
              const state = locationMatch[2] ? locationMatch[2].trim() : 'California';
              newAddress = `${newAddress}, ${city}, ${state}`;
            } else {
              newAddress = `${newAddress}, California`;
            }
          } else {
            newAddress = `${newAddress}, California`;
          }
          
          console.log('Final formatted address:', newAddress);
          
          // Skip if this looks like a name pattern
          if (combinedInput.toLowerCase().startsWith('my name is') || combinedInput.toLowerCase().startsWith('i am')) {
            console.log('Skipping address update - looks like a name pattern');
            continue;
          }

          // Update traits with new address and emit identify event
          const addressTraits = {
            caller_address: newAddress,
            address_updated_at: new Date().toISOString()
          };
          
          Object.assign(traits, addressTraits);
          shouldUpdate = true;
          console.log('=== Address Update Ready ===');
          console.log('New address:', newAddress);
          console.log('Updated traits:', traits);

          // Emit identify event to update Segment profile
          if (this.userId) {
            this.emit('identify', {
              userId: this.userId,
              traits: addressTraits
            });

            // Track the address update separately
            this.emit('track', {
              event: 'Address Updated',
              userId: this.userId,
              properties: {
                new_address: newAddress,
                update_timestamp: new Date().toISOString()
              }
            });
          }

          break;
        }
      }

      // Remove the complex Segment update logic here since we're doing it immediately above
      if (shouldUpdate && this.userId) {
        console.log('=== Starting Segment Update ===');
        console.log('Current userId:', this.userId);
        console.log('Current traits to update:', traits);
      } else {
        console.log('Skipping Segment update:', {
          shouldUpdate,
          userId: this.userId,
          hasTraits: Object.keys(traits).length > 0
        });
      }
    }

    let stream = await this.openai.chat.completions.create({
      model: this.model,  
      messages: this.userContext,
      tools: tools,
      stream: true,
      temperature: 0.5,
    });

    let completeResponse = '';
    let currentSentence = '';
    let functionNames = [];
    let functionArgs = '';
    let finishReason = '';
    let hasSearchBeenCalled = false; // Track if a search has been called this turn

    function collectToolInformation(deltas) {
      let name = deltas.tool_calls[0]?.function?.name || '';
      if (name && !functionNames.includes(name)) {
        functionNames.push(name);
        console.log('Tool called:', name);
      }
      let args = deltas.tool_calls[0]?.function?.arguments || '';
      if (args != '') {
        functionArgs += args;
      }
    }

    // Helper function to clean text for speech
    function cleanTextForSpeech(text) {
      return text
        .replace(/\*\*/g, '')
        .replace(/\n+/g, '. ')
        .replace(/:\s+/g, ': ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    // Helper function to emit cleaned sentence
    const emitCleanedSentence = (sentence, isComplete) => {
      if (sentence.trim()) {
        const cleanedSentence = cleanTextForSpeech(sentence);
        if (cleanedSentence) {
          this.emit('gptreply', cleanedSentence, isComplete, interactionCount);
        }
      }
    };

    for await (const chunk of stream) {
      if (this.isInterrupted) {
        break;
      }

      let content = chunk.choices[0]?.delta?.content || '';
      let deltas = chunk.choices[0].delta;
      finishReason = chunk.choices[0].finish_reason;

      if (deltas.tool_calls) {
        collectToolInformation(deltas);
      }

      if (finishReason === 'tool_calls') {
        const validatedArgsArray = this.validateFunctionArgs(functionArgs);
        
        // Process all function calls at once
        const searchFunctions = ['findHotelRoom', 'findNearestShelter', 'findNearestAnimalShelter', 'findNearestFoodBank'];
        let hasSearchBeenCalled = false;
        let hasCompletionBeenCalled = false;

        for (let i = 0; i < functionNames.length; i++) {
          const functionName = functionNames[i];
          const functionArgs = validatedArgsArray[i];
          
          if (!functionArgs) {
            console.error(`Invalid args for ${functionName}`);
            continue;
          }

          const isSearchFunction = searchFunctions.includes(functionName);

          // Skip if we've already done a search this turn
          if (isSearchFunction && hasSearchBeenCalled) {
            console.log(`Search already performed this turn, skipping ${functionName}`);
            continue;
          }

          const functionToCall = availableFunctions[functionName];
          const toolData = tools.find(tool => tool.function.name === functionName);
          
          // Only emit the initial search message for hotel searches
          if (role === 'user' && isSearchFunction && !hasSearchBeenCalled && functionName === 'findHotelRoom') {
            let say = toolData.function.say;
            if (functionArgs.cityName) {
              const cityMatch = functionArgs.cityName.match(/([^,]+?)(?:,|\s+in\s+)/i);
              const city = cityMatch ? cityMatch[1].trim() : functionArgs.cityName;
              say = functionArgs.isPetFriendly ? 
                `Let me search for pet-friendly hotel rooms in ${city}.` :
                `Let me search for available hotel rooms in ${city}.`;
            }
            this.emit('gptreply', say, false, interactionCount);
          }

          let functionResponse = await functionToCall(functionArgs);
          this.emit('tools', functionName, functionArgs, functionResponse);

          if (isSearchFunction) {
            hasSearchBeenCalled = true;
            
            // Format the response based on function type
            if (functionName === 'findHotelRoom') {
              const hotelData = JSON.parse(functionResponse);
              let hotelMessage = '';
              
              if (hotelData.error) {
                const cityMatch = functionArgs.cityName.match(/([^,]+)/);
                const city = cityMatch ? cityMatch[1].trim() : functionArgs.cityName;
                hotelMessage = `I'm having trouble finding available hotel rooms in ${city} right now. Could you please confirm the city name or try a different nearby city?`;
              } else {
                const petFriendlyStatus = hotelData.isPetFriendly ? 
                    "The hotel is pet-friendly and accepts pets. " : 
                    "Unfortunately, this hotel does not accept pets. ";
                    
                hotelMessage = `I've found emergency accommodation at ${hotelData.hotelName} located at ${hotelData.address}. ${petFriendlyStatus}The room is a ${hotelData.bedType} room priced at ${hotelData.price} per night. This room is available for check-in on ${hotelData.checkIn}. Would you like me to send these details to your phone via text message?`;
              }
              
              functionResponse = hotelMessage;
            } else if (functionName === 'findNearestShelter' || functionName === 'findNearestAnimalShelter') {
              const shelterData = JSON.parse(functionResponse);
              let shelterMessage = '';
              
              if (shelterData.error) {
                shelterMessage = shelterData.error;
              } else {
                const distanceMsg = parseFloat(shelterData.distance) > 50 ? 
                    `I've found a shelter, but it's quite far—about ${shelterData.distance} away in ${shelterData.city}, ${shelterData.state}` :
                    `I've found a shelter ${shelterData.distance} away in ${shelterData.city}, ${shelterData.state}`;
                
                const servicesMsg = `It's the ${shelterData.name}, which ${shelterData.notes || 'provides shelter services'}`;
                
                const hoursMsg = shelterData.hours ? `They're open ${shelterData.hours}` : '';
                
                const phoneMsg = shelterData.phones ? `You can reach them at ${shelterData.phones.split(',')[0].trim()}` : '';
                
                shelterMessage = `${distanceMsg}. ${servicesMsg}.`;
                if (hoursMsg) shelterMessage += ` ${hoursMsg}.`;
                if (phoneMsg) shelterMessage += ` ${phoneMsg}.`;
                
                if (shelterData.suggestAlternatives) {
                    shelterMessage += " Since this shelter is quite far, would you like me to help find a hotel room closer to your location that accepts pets? I can also send you the shelter information via text message for your records.";
                }

                // Add the address as a user trait instead of event property
                if (functionArgs.address) {
                    this.emit('identify', {
                        userId: this.userId,
                        traits: {
                            caller_address: functionArgs.address,  // Use caller_address
                            address_updated_at: new Date().toISOString()
                        }
                    });
                }

                // Add shelter search results as event properties
                this.emit('track', 'Shelter Search', {
                    closest_shelter: shelterData.name,
                    shelter_location: `${shelterData.address}, ${shelterData.city}, ${shelterData.state} ${shelterData.zip}`,
                    distance: shelterData.distance
                });
              }
              
              functionResponse = shelterMessage;
            } else if (functionName === 'findNearestFoodBank') {
              const foodBankData = JSON.parse(functionResponse);
              let foodBankMessage = '';
              
              if (foodBankData.error) {
                foodBankMessage = foodBankData.error;
              } else {
                // Track food bank search event
                this.emit('track', 'Food Bank Search', {
                  closest_food_bank: foodBankData.name,
                  food_bank_location: `${foodBankData.address}, ${foodBankData.city}, ${foodBankData.county}`,
                  distance: foodBankData.distance,
                  phone: foodBankData.phone,
                  timestamp: new Date().toISOString()
                });

                // Update user's address in Segment
                if (functionArgs.address && this.userId) {
                  this.emit('identify', {
                    userId: this.userId,
                    traits: {
                      caller_address: functionArgs.address,  // Use caller_address
                      address_updated_at: new Date().toISOString()
                    }
                  });
                }

                foodBankMessage = `I've found a food bank about ${foodBankData.distance} away from you in ${foodBankData.city}, California. It's the ${foodBankData.name} located at ${foodBankData.address}. You can reach them at ${foodBankData.phone}. Would you like me to send these details to your phone?`;
              }
              
              functionResponse = foodBankMessage;
            }
            
            // Update context and emit response only once
            this.updateUserContext(functionName, 'function', functionResponse);
            this.emit('gptreply', functionResponse, true, interactionCount);
            
            // Skip completion for search functions to avoid redundant messages
            continue;
          } else if (functionName === 'sendSMS') {
            // Emit single SMS confirmation message
            this.emit('gptreply', "I'm sending that information to your phone now. You should receive it shortly. Is there anything else you need help with?", true, interactionCount);
            this.updateUserContext(functionName, 'function', functionResponse);
            continue;
          } else {
            this.updateUserContext(functionName, 'function', functionResponse);
          }

          // Only do one completion per turn for non-search functions
          if (!hasCompletionBeenCalled) {
            hasCompletionBeenCalled = true;
            await this.completion(functionResponse, interactionCount, 'function', functionName);
          }
        }
      } 
      else {
        completeResponse += content;
        currentSentence += content;

        const breakpoints = ['. ', '! ', '? ', '\n', ': '];
        const hasBreakpoint = breakpoints.some(bp => content.includes(bp));

        if (hasBreakpoint) {
          let parts = currentSentence.split(/(?<=[\.\!\?\:\n])\s+/);
          
          for (let i = 0; i < parts.length - 1; i++) {
            emitCleanedSentence(parts[i], false);
          }
          
          currentSentence = parts[parts.length - 1];
        }

        if (finishReason === 'stop') {
          emitCleanedSentence(currentSentence, true);
        }
      }
    }
    this.userContext.push({'role': 'assistant', 'content': completeResponse});
    console.log('Context updated');
  }
}

module.exports = { GptService };
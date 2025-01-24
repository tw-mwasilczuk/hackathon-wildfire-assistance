require('colors');
const EventEmitter = require('events');
const OpenAI = require('openai');
const tools = require('../functions/function-manifest');
const { prompt, userProfile } = require('./prompt');

// Import all functions included in function manifest
// Note: the function name and file name must be the same
const availableFunctions = {};

tools.forEach((tool) => {
  let functionName = tool.function.name;
  availableFunctions[functionName] = require(`../functions/${functionName}`);
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
    ],
    this.partialResponseIndex = 0;
    this.isInterrupted = false;
    this.lastHotelSearch = 0;
    this.lastShelterSearch = 0;
    this.searchCooldown = 2000; // 2 seconds cooldown
    this.lastUserInput = ''; // Store the last user input
    this.lastInputTime = 0; // Store the timestamp of the last input
    this.inputTimeout = 1000; // Wait 1 second for more input

    console.log(`GptService init with model: ${this.model}`);
  }

  setCallInfo(info, value) {
    console.log('setCallInfo', info, value);
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
        const searchFunctions = ['findHotelRoom', 'findNearestShelter', 'findNearestAnimalShelter'];
        let hasSearchBeenCalled = false;

        for (let i = 0; i < functionNames.length; i++) {
            const functionName = functionNames[i];
            const functionArgs = validatedArgsArray[i];
            
            if (!functionArgs) {
                console.error(`Invalid args for ${functionName}`);
                continue;
            }

            const isSearchFunction = searchFunctions.includes(functionName);

            if (isSearchFunction) {
                if (hasSearchBeenCalled) {
                    console.log(`Search already performed this turn, skipping ${functionName}`);
                    continue;
                }

                const now = Date.now();
                const lastSearch = functionName === 'findHotelRoom' ? this.lastHotelSearch : this.lastShelterSearch;
                if (now - lastSearch < this.searchCooldown) {
                    console.log(`${functionName} cooldown active, skipping`);
                    continue;
                }

                if (functionName === 'findHotelRoom') {
                    this.lastHotelSearch = now;
                } else {
                    this.lastShelterSearch = now;
                }
                hasSearchBeenCalled = true;
            }

            const functionToCall = availableFunctions[functionName];
            const toolData = tools.find(tool => tool.function.name === functionName);
            
            if (role === 'user' && isSearchFunction) {
                const say = toolData.function.say;
                this.emit('gptreply', say, false, interactionCount);
            }

            let functionResponse = await functionToCall(functionArgs);
            this.emit('tools', functionName, functionArgs, functionResponse);

            if (isSearchFunction) {
                if (functionName === 'findHotelRoom') {
                    const hotelData = JSON.parse(functionResponse);
                    let hotelMessage = '';
                    
                    if (hotelData.error) {
                        hotelMessage = hotelData.error;
                    } else {
                        const petFriendlyStatus = hotelData.isPetFriendly ? 
                            "The hotel is pet-friendly and accepts pets. " : 
                            "Unfortunately, this hotel does not accept pets. ";
                            
                        hotelMessage = `I've found emergency accommodation at ${hotelData.hotelName} located at ${hotelData.address}. ${petFriendlyStatus}The room is a ${hotelData.bedType} room priced at ${hotelData.price} per night. This room is available for check-in on ${hotelData.checkIn}.`;
                        
                        // Add a clear call to action
                        hotelMessage += " Would you like me to send these details to your phone via text message?";
                    }
                    
                    // Update the function response with our formatted message
                    functionResponse = hotelMessage;
                } else if (functionName === 'findNearestShelter' || functionName === 'findNearestAnimalShelter') {
                    const shelterData = JSON.parse(functionResponse);
                    let shelterMessage = '';
                    
                    if (shelterData.error) {
                        shelterMessage = shelterData.error;
                    } else {
                        // Format distance message
                        const distanceMsg = parseFloat(shelterData.distance) > 50 ? 
                            `I've found a shelter, but it's quite far—about ${shelterData.distance} away in ${shelterData.city}, ${shelterData.state}` :
                            `I've found a shelter ${shelterData.distance} away in ${shelterData.city}, ${shelterData.state}`;
                        
                        // Format services message
                        const servicesMsg = `It's the ${shelterData.name}, which provides ${shelterData.services}`;
                        
                        // Format hours message
                        const hoursMsg = `They're open ${shelterData.hours}`;
                        
                        // Format phone message
                        const phoneMsg = `You can reach them at ${shelterData.phones.split(',')[0].trim()}`;
                        
                        // Combine messages
                        shelterMessage = `${distanceMsg}. ${servicesMsg}. ${hoursMsg}. ${phoneMsg}.`;
                        
                        // Add alternatives suggestion if needed
                        if (shelterData.suggestAlternatives) {
                            shelterMessage += " Since this shelter is quite far, would you like me to help find a hotel room closer to your location? I can also send you the shelter information via text message for your records.";
                        }
                    }
                    
                    // Update the function response with our formatted message
                    functionResponse = shelterMessage;
                }
                
                // Always update context with the function response
                this.updateUserContext(functionName, 'function', functionResponse);
                
                // For search functions, we want to immediately relay the response to the user
                this.emit('gptreply', functionResponse, true, interactionCount);
                
                // Continue the conversation by having GPT process the search results
                await this.completion(functionResponse, interactionCount, 'function', functionName);
                break;
            } else {
                this.updateUserContext(functionName, 'function', functionResponse);
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
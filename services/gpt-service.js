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
      { 'role': 'assistant', 'content': 'Hello! Welcome to Owl Shoes, how can I help you today?' },
    ],
    this.partialResponseIndex = 0;
    this.isInterrupted = false;
    this.lastHotelSearch = 0;
    this.lastShelterSearch = 0;
    this.searchCooldown = 2000; // 2 seconds cooldown

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
      this.userContext.push({ 'role': role, 'name': name, 'content': text });
    } else {
      this.userContext.push({ 'role': role, 'content': text });
    }
  }

  async completion(text, interactionCount, role = 'user', name = 'user') {
    console.log('GptService completion: ', role, name, text);
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
      // Only log when we have a complete JSON object
      if (args.endsWith('}')) {
        try {
          const parsedArgs = JSON.parse(functionArgs);
          console.log('Tool arguments:', parsedArgs);
        } catch (e) {
          // Not a complete JSON object yet, skip logging
        }
      }
    }

    // Helper function to clean text for speech
    function cleanTextForSpeech(text) {
      return text
        .replace(/\*\*/g, '') // Remove markdown bold
        .replace(/\n+/g, '. ') // Replace newlines with periods
        .replace(/:\s+/g, ': ') // Clean up colons
        .replace(/\s+/g, ' ') // Remove extra spaces
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
        console.log(`validatedArgsArray is ${JSON.stringify(validatedArgsArray)}`);
        let index = 0;
        functionNames.forEach(async (functionName) => {
          const functionToCall = availableFunctions[functionName];
          let functionArgs = validatedArgsArray[index]
          if (!functionArgs) {
            console.error(`function args where undefined for ${index}, ${validatedArgsArray}, ${functionName}`)
            return;
          }
          index=index+1;
          console.log('validatedArgs', functionArgs);
          const toolData = tools.find(tool => tool.function.name === functionName);
          
          // Check cooldown before emitting message or calling function
          if (functionName === 'findHotelRoom' || functionName === 'findNearestShelter') {
            const now = Date.now();
            const lastSearch = functionName === 'findHotelRoom' ? this.lastHotelSearch : this.lastShelterSearch;
            if (now - lastSearch < this.searchCooldown) {
              console.log(`${functionName} cooldown active, skipping duplicate call`);
              return;
            }
            if (functionName === 'findHotelRoom') {
              this.lastHotelSearch = now;
            } else {
              this.lastShelterSearch = now;
            }
          }

          const say = toolData.function.say;
          this.emit('gptreply', say, false, interactionCount);
          
          let functionResponse = await functionToCall(functionArgs);
          this.emit('tools', functionName, functionArgs, functionResponse);
          this.updateUserContext(functionName, 'function', functionResponse);
          await this.completion(functionResponse, interactionCount, 'function', functionName);
        })
      } 
      else {
        completeResponse += content;
        currentSentence += content;

        // Check for natural breakpoints
        const breakpoints = ['. ', '! ', '? ', '\n', ': '];
        const hasBreakpoint = breakpoints.some(bp => content.includes(bp));

        if (hasBreakpoint) {
          // Split on any breakpoint and handle each part
          let parts = currentSentence.split(/(?<=[\.\!\?\:\n])\s+/);
          
          // Emit all complete parts except the last one
          for (let i = 0; i < parts.length - 1; i++) {
            emitCleanedSentence(parts[i], false);
          }
          
          // Keep the last part if it's incomplete
          currentSentence = parts[parts.length - 1];
        }

        if (finishReason === 'stop') {
          emitCleanedSentence(currentSentence, true);
          console.log('emit gptreply stop');
        }
      }
    }
    this.userContext.push({'role': 'assistant', 'content': completeResponse});
    console.log(`GPT -> user context length: ${this.userContext.length}`.green);
  }
}

module.exports = { GptService };
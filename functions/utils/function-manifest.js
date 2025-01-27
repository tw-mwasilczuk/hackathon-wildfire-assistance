// create metadata for all the available functions to pass to completions API
const tools = [
  // {
  //   type: 'function',
  //   function: {
  //     name: 'checkInventory',
  //     say: 'Let me check our inventory right now.',
  //     description: 'Check the inventory of airpods, airpods pro or airpods max.',
  //     parameters: {
  //       type: 'object',
  //       properties: {
  //         model: {
  //           type: 'string',
  //           'enum': ['airpods', 'airpods pro', 'airpods max'],
  //           description: 'The model of airpods, either the airpods, airpods pro or airpods max',
  //         },
  //       },
  //       required: ['model'],
  //     },
  //     returns: {
  //       type: 'object',
  //       properties: {
  //         stock: {
  //           type: 'integer',
  //           description: 'An integer containing how many of the model are in currently in stock.'
  //         }
  //       }
  //     }
  //   },
  // },
  // {
  //   type: 'function',
  //   function: {
  //     name: 'checkPrice',
  //     say: 'Let me check the price, one moment.',
  //     description: 'Check the price of given model of airpods, airpods pro or airpods max.',
  //     parameters: {
  //       type: 'object',
  //       properties: {
  //         model: {
  //           type: 'string',
  //           'enum': ['airpods', 'airpods pro', 'airpods max'],
  //           description: 'The model of airpods, either the airpods, airpods pro or airpods max',
  //         },
  //       },
  //       required: ['model'],
  //     },
  //     returns: {
  //       type: 'object',
  //       properties: {
  //         price: {
  //           type: 'integer',
  //           description: 'the price of the model'
  //         }
  //       }
  //     }
  //   },
  // },
  // {
  //   type: 'function',
  //   function: {
  //     name: 'transferCall',
  //     say: 'One moment while I transfer your call.',
  //     description: 'Transfers the customer to a live agent in case they request help from a real person.',
  //     parameters: {
  //       type: 'object',
  //       properties: {
  //         callSid: {
  //           type: 'string',
  //           description: 'The unique identifier for the active phone call.',
  //         },
  //       },
  //       required: ['callSid'],
  //     },
  //     returns: {
  //       type: 'object',
  //       properties: {
  //         status: {
  //           type: 'string',
  //           description: 'Whether or not the customer call was successfully transfered'
  //         },
  //       }
  //     }
  //   },
  // },

  {
    type: 'function',
    function: {
      name: "getWeather",
      description: "Get the current weather for a given location.",
      say: 'Let me check the weather for you.',
      parameters: {
        type: "object",
        properties: {
          location: { type: "string", description: "The city name (e.g., London, Paris)." },
        },
        required: ["location"],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: "changeLanguage",
      description: "Change the current conversation language to user preference, treat en-US, en-GB, es-ES, es-MX etc. as different languages.",
      parameters: {
        type: "object",
        properties: {
          language: { type: "string", description: "The language codes preferred by the user and should be changed to, the format like en-US, fr-FR etc. If the user requests language without specifying the region, default to the system's initial language with region if they are the same." },
        },
        required: ["language"],
      },
    },
  },
  
  {
    type: 'function',
    function: {
      name: "findHotelRoom",
      description: "Find available hotel rooms in a specified city, with option to filter for pet-friendly hotels.",
      say: 'Let me search for available hotel rooms in that city.',
      parameters: {
        type: "object",
        properties: {
          cityName: { 
            type: "string", 
            description: "The name of the city to search for hotel rooms in." 
          },
          petFriendly: {
            type: "boolean",
            description: "Whether to search specifically for pet-friendly hotels",
            default: false
          }
        },
        required: ["cityName"],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: "sendSMS",
      description: "Send an SMS message to the user's phone number with emergency accommodation details.",
      say: "I'll send that information to your phone right away.",
      parameters: {
        type: "object",
        properties: {
          phoneNumber: {
            type: "string",
            description: "The phone number to send the SMS to in E.164 format"
          },
          messageBody: {
            type: "string",
            description: "The message body to send in the SMS. For hotel information, include hotel name, address, room type, price, and check-in details."
          }
        },
        required: ["phoneNumber", "messageBody"],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: "findNearestShelter",
      description: "Find the nearest homeless shelter or service based on the user's address.",
      say: "I'll help you find the closest shelter to that location.",
      parameters: {
        type: "object",
        properties: {
          address: {
            type: "string",
            description: "The user's current address or location to find the nearest shelter from"
          }
        },
        required: ["address"],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: "findNearestAnimalShelter",
      description: "Find the nearest animal shelter that accepts either small animals (cats, dogs, etc.) or large animals (horses, livestock) based on the user's address and animal type.",
      say: "I'll help you find the closest animal shelter that can accommodate your pets.",
      parameters: {
        type: "object",
        properties: {
          address: {
            type: "string",
            description: "The user's current address or location to find the nearest animal shelter from"
          },
          animalType: {
            type: "string",
            description: "The type of animal needing shelter: 'small' for cats/dogs/small pets, or 'large' for horses/livestock",
            enum: ["small", "large"]
          }
        },
        required: ["address", "animalType"]
      },
    },
  },

  {
    type: 'function',
    function: {
      name: "findNearestFoodBank",
      description: "Find the nearest food bank to a given address in California",
      parameters: {
        type: "object",
        properties: {
          address: {
            type: "string",
            description: "The address to find the nearest food bank to"
          }
        },
        required: ["address"]
      },
      say: "Let me find the nearest food bank to that location."
    },
  },
];

module.exports = tools;
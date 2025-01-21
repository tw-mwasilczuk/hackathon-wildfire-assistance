const axios = require('axios');

async function changeLanguage(functionArgs) {
  let lang = functionArgs.language;
  console.log('GPT -> called changeLanguage function', lang);

  return 'change current language to ' + lang;
  
}

module.exports = changeLanguage;
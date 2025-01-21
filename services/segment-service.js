const { Analytics } = require('@segment/analytics-node');
const axios = require('axios');
require('dotenv').config();

const profileToken = process.env.PROFILE_TOKEN;
const spaceID = process.env.SPACE_ID;
const analytics = new Analytics({ writeKey: process.env.WRITE_KEY });

const baseURL = 'https://profiles.segment.com/v1';
// eslint-disable-next-line no-undef
const credentials = Buffer.from(`${profileToken}:`).toString('base64');
const config = {
  headers: {
    Authorization: `Basic ${credentials}`,
  },
};

/**
 * Adds user and or updates their traits by identifying them with their userId or anonymousId, plus any optional traits.
 * At least one of `userId` or `anonymousId` is required. The `traits` object can contain any key-value pair.
 *
 * @param {Object} params - The parameters object for adding a user.
 * @param {string} [params.userId] - The unique identifier for the user. One of `userId` or `anonymousId` is required.
 * @param {string} [params.anonymousId] - The unique anonymous identifier for the user. One of `userId` or `anonymousId` is required.
 * @param {Object<string, *>} [params.traits] - An optional object that contains key-value pairs describing additional traits for the user.
 *
 * @throws {Error} If neither `userId` nor `anonymousId` is provided.
 */
function upsertUser({ userId, anonymousId, traits }) {
  try {
    if (!userId && !anonymousId) {
      throw new Error('Either `userId` or `anonymousId` must be provided.');
    }

    analytics.identify({ userId, anonymousId, traits });
  } catch (error) {
    console.error('Error adding user:', error);
  }
  console.log('add user done');
}

/**
 * Track an event for a user in Segment.its.
 * At least one of `userId` or `anonymousId` is required. The `properties` object can contain any key-value pair.
 *
 * @param {Object} params - The parameters object for adding a user.
 * @param {string} [params.userId] - The unique identifier for the user. One of `userId` or `anonymousId` is required.
 * @param {string} [params.anonymousId] - The unique anonymous identifier for the user. One of `userId` or `anonymousId` is required.
 * @param {string} [params.event] - The name of the event to track.
 * @param {Object<string, *>} [params.properties] - An optional object that contains key-value pairs describing additional properties for the user.
 *
 * @throws {Error} If neither `userId` nor `anonymousId` is provided.
 */
function addEvent({ userId, anonymousId, event, properties }) {
  try {
    if (!userId && !anonymousId) {
      throw new Error('Either `userId` or `anonymousId` must be provided.');
    }

    analytics.track({ userId, anonymousId, event, properties });
  } catch (error) {
    console.error('Error adding user:', error);
  }
  console.log('add addEvent done');
}

/**
 * Fetch the profile data of a user from Segment using their ID.
 *
 * @param {string} userId - The unique user ID.
 * @returns {Promise<Object|null>} - A promise that resolves with the user's traits if successful, or null if there is an error.
 */
async function getProfileTraits(userId) {
  try {
    const response = await axios.get(
      `${baseURL}/spaces/${spaceID}/collections/users/profiles/user_id:${encodeURIComponent(
        userId
      )}/traits`,
      config
    );

    if (response.data.traits) {
      const traits = response.data.traits;
      console.log('getProfileTraits: ', traits);
      return traits;
    }

    return null;
  } catch (error) {
    if (error.response.status === 404) {
      console.log('User not found');
    } else {
      console.error('Error Occurred - :', error);
    }

    return null;
  }
}

/**
 * Fetch the events data of a user from Segment using their ID.
 *
 * @param {string} userId - The unique user ID.
 * @returns {Promise<{data: Array<Object>}|null>} - A promise that resolves with the user's events if successful, or null if there is an error.
 */
async function getProfileEvents(userId) {
  try {
    const response = await axios.get(
      `${baseURL}/spaces/${spaceID}/collections/users/profiles/user_id:${encodeURIComponent(
        userId
      )}/events`,
      config
    );

    if (response.data) {
      const data = response.data;
      console.log('getProfileEvents: ', data);
      return data;
    }

    return null;
  } catch (error) {
    if (error.response.status === 404) {
      console.log('User not found');
    } else {
      console.error('Error Occurred - :', error);
    }

    return null;
  }
}

/**
 * Read and process event data, extracting specified properties from each item.
 *
 * @param {Object} jsonData - The raw event data to process.
 * @param {Array<string>} propertyList - Optional list of property names to extract from each item.
 * @returns {Array<{event: String, properties: Object}>} - An array of objects containing the extracted properties.
 */
function readProperties(jsonData, propertyList = null) {
  try {
    const results = [];

    jsonData.data.forEach((item) => {
      const extractedData = {
        event: item.event,
        properties: {},
      };

      // If no propertyList is provided, add all properties to the extractedData object.
      if (!propertyList) {
        extractedData.properties = item.properties;
        results.push(extractedData);
      } else {
        // Loop through the propertyList and extract each property from item.properties.
        let foundProperty = false;
        propertyList.forEach((property) => {
          if (Object.prototype.hasOwnProperty.call(item.properties, property)) {
            foundProperty = true;
            extractedData.properties[property] = item.properties[property];
          }
        });

        if (foundProperty) {
          results.push(extractedData);
        }
      }
    });

    console.log('readProperties: ', results);
    return results;
  } catch (error) {
    console.error('Error parsing JSON data:', error);
  }
}

module.exports = {
  upsertUser,
  addEvent,
  getProfileTraits,
  getProfileEvents,
  readProperties,
};

/* Example usage:

  upsertUser({
    userId: '8967',
    traits: {
      name: 'John Black',
      phone: '+491234567',
      address: 'Berlin, Germany',
    },
  });

  addEvent({
    userId: '8967',
    event: 'Order Placed',
    properties: {
      order: 'Medium eggplant pizza with sausages and AI sauce',
      price: 13,
      shippingMethod: 'Delivery',
    },
  });

  await getEvents('8967');

  getProfile('8967');
*/

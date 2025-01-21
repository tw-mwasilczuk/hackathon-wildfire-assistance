const setTimeout = require('timers/promises').setTimeout;
const {
  upsertUser,
  addEvent,
  getProfileTraits,
  getProfileEvents,
  readProperties,
} = require('../services/segment-service');
require('dotenv').config();

const stubbedData = {
  userId: '+1234567890',
  traits: {
    name: 'John Doe',
    phone: '+1234567890',
    address: '123 Main St',
  },
  event: 'Pizza Ordered',
  properties: {
    order: 'Pepperoni',
    price: 15.99,
    shippingMethod: 'delivery',
  },
};

test('Expect A new user to be added and their profile traits retrieved', async () => {
  const { userId, traits, event, properties } = stubbedData;

  upsertUser({ userId, traits });
  await setTimeout(15000);

  addEvent({ userId, event, properties });
  await setTimeout(15000);

  const profileTraits = await getProfileTraits(userId);

  expect(profileTraits).toMatchObject(traits);
}, 50000);

test('Expect new user to be added and their events retrieved - array with objects containing requested properties', async () => {
  const { userId, traits, event, properties } = stubbedData;

  upsertUser({ userId, traits });
  await setTimeout(15000);

  addEvent({ userId, event, properties });
  await setTimeout(15000);

  const events = await getProfileEvents(userId);

  const propertyList = readProperties(events, [
    'order',
    'price',
    'shippingMethod',
  ]);

  expect(propertyList).toEqual(
    expect.arrayContaining([expect.objectContaining({ event, properties })])
  );
}, 50000);

test('Expect new user to be added and their events retrieved - empty array returned as invalid property is requested', async () => {
  const { userId, traits, event, properties } = stubbedData;

  upsertUser({ userId, traits });
  await setTimeout(15000);

  addEvent({ userId, event, properties });
  await setTimeout(15000);

  const events = await getProfileEvents(userId);

  const propertyList = readProperties(events, ['not-found-property']);

  expect(propertyList).toHaveLength(0);
}, 50000);

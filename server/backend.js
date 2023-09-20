const WebSocket = require("ws");
const redis = require("redis");
let publisher;
let redisClient;

const redisExpireTimeInSeconds = 10;

let clients = [];
let messageHistory = [];

// Intiiate the websocket server
const initializeWebsocketServer = async (server) => {
  redisClient = redis.createClient({
    socket: {
      host: process.env.REDIS_HOST || "localhost",
      port: process.env.REDIS_PORT || "6379",
    },
  });
  await redisClient.connect();
  // This is the subscriber part
  const subscriber = redisClient.duplicate();
  await subscriber.connect();
  // This is the publisher part
  publisher = redisClient.duplicate();
  await publisher.connect();

  const websocketServer = new WebSocket.Server({ server });
  websocketServer.on("connection", onConnection);
  websocketServer.on("error", console.error);
  await subscriber.subscribe("newMessage", onRedisMessage);
  // Start the heartbeat once the server has been initialized
  heartbeat();
};

// If a new connection is established, the onConnection function is called
const onConnection = (ws) => {
  console.log("New websocket connection");
  pushMessages();
  ws.on("close", () => onClose(ws));
  ws.on("message", (message) => onClientMessage(ws, message));
  ws.send(JSON.stringify({ type: "ping", data: "FROM SERVER" }));
};

// Get all users from redis
const getUsersFromRedis = async () => {
  let userKeys = await redisClient.keys("user:*");
  
  let users = [];
  for (let i = 0; i < userKeys.length; i++) {
    let user = await redisClient.get(userKeys[i]);
    if (user) {
      users.push(JSON.parse(user));
    }
  }

  return users;
};

// Get all messages from redis
const getMessagesFromRedis = async () => {
  let messageKeys = await redisClient.keys("message:*");
  console.log('keys', messageKeys)
  let messages = [];
  for (let i = 0; i < messageKeys.length; i++) {
    let message = await redisClient.get(messageKeys[i]);
    if (message) {
      messages.push(JSON.parse(message));
    }
  }

  return messages;
};

// If a new message is received, the onClientMessage function is called
const onClientMessage = async (ws, message) => {
  const messageObject = JSON.parse(message);
  console.log("Received message from client: " + messageObject.type);
  switch (messageObject.type) {
    case "user":
      clients = clients.filter((client) => client.ws !== ws);
      clients.push({ ws, user: messageObject.user });
      console.log("Number of clients: " + clients.length);
      console.log("clients: " + clients);
      redisClient.set(
        `user:${messageObject.user.id}`,
        JSON.stringify(messageObject.user)
      );
      redisClient.expire(
        `user:${messageObject.user.id}`,
        redisExpireTimeInSeconds
      );
      const message = {
        type: "pushUsers",
      };
      publisher.publish("newMessage", JSON.stringify(message));
      break;
    case "message":
      messageHistory.push({ws, message: messageObject.message});
      //console.log('MessageHistory', messageHistory);
      redisClient.set(
        `message:${messageObject.message.user.id}`,
        JSON.stringify(messageObject.message)
      );
      //setMessageHistory(messageHistory);
      //console.log("New Message saved..." + JSON.stringify(messageHistory));
      publisher.publish("newMessage", JSON.stringify(messageObject));
      break;
    default:
      console.error("Unknown message type: " + messageObject.type);
  }
};

// If a new message from the redis channel is received, the onRedisMessage function is called
const onRedisMessage = async (message) => {
  const messageObject = JSON.parse(message);
  console.log("Received message from redis channel: " + messageObject.type);
  switch (messageObject.type) {
    case "message":
      clients.forEach((client) => {
        client.ws.send(JSON.stringify(messageObject));
      });
      break;
    case "pushUsers":
      await pushUsers();
      break;
    default:
      console.error("Unknown message type: " + messageObject.type);
  }
};

// If a connection is closed, the onClose function is called
const onClose = async (ws) => {
  console.log("Websocket connection closed");
  const client = clients.find((client) => client.ws === ws);
  if (!client) return;
  redisClient.del(`user:${client.user.id}`);
  const message = {
    type: "pushUsers",
  };
  publisher.publish("newMessage", JSON.stringify(message));
  clients = clients.filter((client) => client.ws !== ws);
};

// The heartbeat function is called every 5 seconds
const heartbeat = async () => {
  for (let i = 0; i < clients.length; i++) {
    redisClient.expire(`user:${clients[i].user.id}`, redisExpireTimeInSeconds);
  }
  await pushUsers();
  setTimeout(heartbeat, (redisExpireTimeInSeconds * 1000) / 2);
};

// Push the users to all connected clients
const pushUsers = async () => {
  const users = await getUsersFromRedis();
  const message = {
    type: "users",
    users,
  };
  clients.forEach((client) => {
    client.ws.send(JSON.stringify(message));
  });
};

// Push messages to new connected clients
const pushMessages = async () => {
  const message = await getMessagesFromRedis();
  console.log('Nachrichtem:', message);
  clients.forEach((client) => {
    client.ws.send(JSON.stringify(message));
  });
  //const message1 = {
  //  type: "message",
  //  messages,
  //};
  //messageHistory.forEach((messag) => {
  //  messag.ws.send(JSON.stringify(message1));
  //});
};

const getMessageHistory = async () => {
  return await redisClient.get("messageHistory");
};

const setMessageHistory = async (messageHistory) => {
  await redisClient.set("messageHistory", JSON.stringify(messageHistory));
};

module.exports = { initializeWebsocketServer };


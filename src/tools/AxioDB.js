import {AxioDB} from 'axiodb';
import { HISTORY_LIMIT, IST_OFFSET_MS } from './config.js';

let personalChat;
let groupChats;
let schedules;

// Call once at startup before saveMessage/getRecentMessages are used.
// Local/native instance only — no GUI, no TCP, no cloud. Stores under ./AxioDB in the project root.
export const initChatHistory = async () => {
  const Instance = new AxioDB({ GUI: false });
  const ChatHistoryDB = await Instance.createDB('ChatHistory');
  personalChat = await ChatHistoryDB.createCollection('personalChat');
  groupChats = await ChatHistoryDB.createCollection('groupChats');
  schedules = await ChatHistoryDB.createCollection('schedules');

  await personalChat.newIndex('userId');
  await groupChats.newIndex('userId');
};

function nowIST() {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().replace('Z', '+05:30');
}

function collectionFor(chatId) {
  return chatId.endsWith('@g.us') ? groupChats : personalChat;
}

export async function saveMessage(chatId, userMessage, reply, model) {
  await collectionFor(chatId).insert({
    userId: chatId,
    userMessage,
    reply,
    model,
    timestamp: nowIST(),
  });
}

// Last `limit` messages for this chat, oldest first.
export async function getRecentMessages(chatId, limit = HISTORY_LIMIT) {
  const result = await collectionFor(chatId)
    .query({ userId: chatId })
    .Limit(limit)
    .Skip(0)
    .Sort({ timestamp: -1 })
    .exec();

  const documents = result.data?.documents ?? [];
  return documents.reverse();
}

// One document per (time, topic, recipient) — a daily-recurring or one-time message schedule.
// verbatim: true means `topic` IS the literal message to send every time, unmodified;
// false means `topic` is just an occasion/theme and a fresh message is generated at fire-time.
export async function saveSchedule({ time, topic, recipientId, recipientLabel, recurring, verbatim }) {
  await schedules.insert({
    time,
    topic,
    recipientId,
    recipientLabel,
    recurring,
    verbatim,
    createdAt: nowIST(),
  });
}

export async function getAllSchedules() {
  const result = await schedules.query({}).exec();
  return result.data?.documents ?? [];
}

// One-time schedules are removed after they fire; recurring ones stay.
export async function deleteSchedule(documentId) {
  await schedules.delete({ documentId }).deleteOne();
}

import {AxioDB} from 'axiodb';
import { HISTORY_LIMIT, IST_OFFSET_MS } from './config.js';

function nowIST() {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().replace('Z', '+05:30');
}

// Owns the AxioDB collection handles and every read/write against them — local/native
// instance only (no GUI, no TCP, no cloud), stored under ./AxioDB in the project root.
class ChatHistoryStore {
  constructor() {
    this.personalChat = null;
    this.groupChats = null;
    this.schedules = null;
  }

  // Call once at startup before any other method is used.
  async init() {
    const instance = new AxioDB({ GUI: false, TCP: false, cloud: false, RootName: "Context" });
    const chatHistoryDB = await instance.createDB('ChatHistory');
    this.personalChat = await chatHistoryDB.createCollection('personalChat');
    this.groupChats = await chatHistoryDB.createCollection('groupChats');
    this.schedules = await chatHistoryDB.createCollection('schedules');

    await this.personalChat.newIndex('userId');
    await this.groupChats.newIndex('userId');
    await this.schedules.newIndex('time');
  }

  collectionFor(chatId) {
    return chatId.endsWith('@g.us') ? this.groupChats : this.personalChat;
  }

  async saveMessage(chatId, userMessage, reply, model) {
    await this.collectionFor(chatId).insert({
      userId: chatId,
      userMessage,
      reply,
      model,
      timestamp: nowIST(),
    });
  }

  // Last `limit` messages for this chat, oldest first.
  async getRecentMessages(chatId, limit) {
    const result = await this.collectionFor(chatId)
      .query({ userId: chatId })
      .Limit(limit)
      .Skip(0)
      .Sort({ timestamp: -1 })
      .exec();

    const documents = result.data?.documents ?? [];
    return documents.reverse();
  }

  // One document per (time, topic, recipient) — a daily-recurring or one-time message
  // schedule. verbatim: true means `topic` IS the literal message to send every time,
  // unmodified; false means `topic` is just an occasion/theme and a fresh message is
  // generated at fire-time. lastFiredDate ("YYYY-MM-DD" or null) tracks the scheduler's
  // own fired-today check — persisted here rather than kept in memory, so it survives a
  // restart and never orphans once its schedule is deleted.
  async saveSchedule({ time, topic, recipientId, recipientLabel, recurring, verbatim }) {
    await this.schedules.insert({
      time,
      topic,
      recipientId,
      recipientLabel,
      recurring,
      verbatim,
      lastFiredDate: null,
      createdAt: nowIST(),
    });
  }

  async getAllSchedules() {
    const result = await this.schedules.query({}).exec();
    return result.data?.documents ?? [];
  }

  // Only schedules due at this exact "HH:MM", instead of loading every schedule and
  // filtering in JS — the minute-check runs 1,440 times a day, so pushing the match down
  // to the query keeps that cost proportional to what's actually due, not the total count.
  async getSchedulesDueAt(time) {
    const result = await this.schedules.query({ time }).exec();
    return result.data?.documents ?? [];
  }

  async markScheduleFired(documentId, dateKey) {
    await this.schedules.update({ documentId }).UpdateOne({ lastFiredDate: dateKey });
  }

  // One-time schedules are removed after they fire; recurring ones stay.
  async deleteSchedule(documentId) {
    await this.schedules.delete({ documentId }).deleteOne();
  }
}

const chatHistoryStore = new ChatHistoryStore();

export async function initChatHistory() {
  return chatHistoryStore.init();
}

export async function saveMessage(chatId, userMessage, reply, model) {
  return chatHistoryStore.saveMessage(chatId, userMessage, reply, model);
}

export async function getRecentMessages(chatId, limit = HISTORY_LIMIT) {
  return chatHistoryStore.getRecentMessages(chatId, limit);
}

export async function saveSchedule(schedule) {
  return chatHistoryStore.saveSchedule(schedule);
}

export async function getAllSchedules() {
  return chatHistoryStore.getAllSchedules();
}

export async function getSchedulesDueAt(time) {
  return chatHistoryStore.getSchedulesDueAt(time);
}

export async function markScheduleFired(documentId, dateKey) {
  return chatHistoryStore.markScheduleFired(documentId, dateKey);
}

export async function deleteSchedule(documentId) {
  return chatHistoryStore.deleteSchedule(documentId);
}

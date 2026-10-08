# OpenAI Plugin for NodeBB

This plugin let's users ask questions to ChatGPT in their forum posts by mentioning the chatgpt user with @<chat_gpt_username>. The user is created by admins and their username is set in the ACP page.

You can also allow users to send private messages to the chatgpt user.

If the chat gpt user is added to a public room it can answer questions by mentioning like in topics.

The model used can be changed in the ACP page.

Get an API key from openai at https://platform.openai.com/api-keys and save it in the ACP page of the plugin and restart your forum.

## Topic summaries

A "Summarize topic" button is added to the topic toolbar for users allowed to use the plugin. It opens a dialog with:

- the summary (markdown), with a note on how many of the posts were read;
- the last 5 versions of the summary of that topic, and a history of the last 20 summarized topics (kept in the user's browser);
- a box for questions about the discussion;
- buttons to publish the summary as a reply, copy it, refresh it, and edit the prompt (the prompt is the user's own and is kept in their browser).

Who provides the API key is an ACP setting ("Who provides the API key for summaries"):

- **Forum key only** (default): the key from the settings above is used. The summary is cached per topic and cleared when posts change. Requests are rate limited per user (setting), administrators are exempt.
- **Each user's own key only**: every user pastes their own key (for Gemini this is free). It is kept in that user's browser and sent with each request over the websocket; the server never stores it.
- **Personal key if entered, otherwise the forum key.**

The key is used with the API base URL from the settings, so a personal key has to belong to the same provider.

## Dependencies

This plugin requires nodebb-plugin-mentions to be installed and active.

## Installation

    npm install nodebb-plugin-openai

## Screenshots

![](./screenshots/screenshot1.png)

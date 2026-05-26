import React, { useEffect, useRef, useState } from 'react';
import './chatroom.css';
import Message from './message.js';
import translateTextAPI from './translateAPI';
import { addChat, useGlobalState } from '../store/state';

const Chatroom = (props) => {

    const [Chats] = useGlobalState('Chats');
    const [currentContactId] = useGlobalState('currentContactId');
    const [languageTranslate] = useGlobalState('languageTranslate');
    const [languageOptions] = useGlobalState('languageOptions');

    const [newMessage, setNewMessage] = useState("");

    const agentUsername = 'AGENT';

    const messageEl = useRef(null);
    const input = useRef(null);

    // Normalize contactId (CRITICAL FIX)
    const contactId = Array.isArray(currentContactId)
        ? currentContactId[0]
        : currentContactId;

    // Get destination language
    const getDestLang = () => {
        return languageTranslate.find(o => o.contactId === contactId);
    };

    // Map language label
    function getKeyByValue(object) {
        const obj = languageTranslate.find(o => o.contactId === contactId);
        if (!obj) return "";
        return Object.keys(object).find(key => object[key] === obj.lang);
    }

    // Send message to CCP
    const sendMessage = async (session, content) => {
        try {
            await session.sendMessage({
                contentType: "text/plain",
                message: content
            });
        } catch (err) {
            console.error("sendMessage error:", err);
        }
    };

    // Auto scroll
    useEffect(() => {
        const el = messageEl.current;
        if (!el) return;

        const handler = (event) => {
            event.currentTarget.scrollTop = event.currentTarget.scrollHeight;
        };

        el.addEventListener('DOMNodeInserted', handler);
        return () => el.removeEventListener('DOMNodeInserted', handler);
    }, []);

    useEffect(() => {
        input.current?.focus();
    }, [contactId]);

    // Session lookup
    function getSession(contactId, sessionMap) {
        if (!sessionMap) return null;

        for (const obj of sessionMap) {
            for (const key in obj) {
                if (key === contactId) {
                    return obj[key];
                }
            }
        }
        return null;
    }

    // Submit message
    async function handleSubmit(e) {
        e.preventDefault();

        if (!newMessage.trim()) return;

        const destLang = getDestLang();

        if (!destLang?.lang) {
            console.error("No language mapping for:", contactId);
            return;
        }

        try {
            const result = await translateTextAPI(
                newMessage,
                'en',
                destLang.lang
            );

            console.log("Translate API result:", result);

            const translatedText = result?.TranslatedText;

            if (!translatedText) {
                console.error("Translation failed:", result);
                return;
            }

            // IMPORTANT: store RAW TEXT only (fixes special characters issue)
            const messageObject = {
                contactId,
                username: agentUsername,
                content: newMessage,
                translatedMessage: translatedText
            };

            addChat(prev => [...prev, messageObject]);

            const session = getSession(contactId, props.session);

            if (session) {
                await sendMessage(session, translatedText);
            } else {
                console.warn("No session found for:", contactId);
            }

            setNewMessage("");

        } catch (err) {
            console.error("handleSubmit error:", err);
        }
    }

    return (
        <div className="chatroom">

            <h3>
                Translate -
                ({languageTranslate.find(l => l.contactId === contactId)?.lang || ""})
                {" "}
                {getKeyByValue(languageOptions)}
            </h3>

            <ul className="chats" ref={messageEl}>
                {Chats
                    .filter(chat => chat.contactId === contactId)
                    .map((chat, idx) => (
                        <Message
                            key={chat.id || `${chat.contactId}-${idx}`}
                            chat={chat}
                            user={agentUsername}
                        />
                    ))}
            </ul>

            <form className="input" onSubmit={handleSubmit}>
                <input
                    ref={input}
                    maxLength={1024}
                    type="text"
                    value={newMessage}
                    onChange={e => setNewMessage(e.target.value)}
                />
                <input type="submit" value="Submit" />
            </form>

        </div>
    );
};

export default Chatroom;
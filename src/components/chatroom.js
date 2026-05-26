import React, { useEffect, useRef, useState } from 'react';
import './chatroom.css';
import Message from './message.js';
import translateTextAPI from './translateAPI';
import { addChat, useGlobalState } from '../store/state';

const Chatroom = (props) => {

    const [Chats] = useGlobalState('Chats');

    // ✅ FIX #1: MUST destructure correctly
    const [currentContactId] = useGlobalState('currentContactId');

    const [newMessage, setNewMessage] = useState("");
    const [languageTranslate] = useGlobalState('languageTranslate');
    const [languageOptions] = useGlobalState('languageOptions');

    const agentUsername = 'AGENT';

    const messageEl = useRef(null);
    const input = useRef(null);

    // ---------------------------
    // LANGUAGE LOOKUP
    // ---------------------------
    const getDestLang = () => {
        return languageTranslate.find(
            o => o.contactId === currentContactId
        );
    };

    function getKeyByValue(object) {
        const obj = languageTranslate.find(
            o => o.contactId === currentContactId
        );

        if (!obj) return "";

        return Object.keys(object).find(
            key => object[key] === obj.lang
        );
    }

    // ---------------------------
    // SEND MESSAGE TO CCP
    // ---------------------------
    const sendMessage = async (session, content) => {
        try {
            const awsSdkResponse = await session.sendMessage({
                contentType: "text/plain",
                message: content
            });

            const { AbsoluteTime, Id } = awsSdkResponse.data;
            console.log("Sent:", AbsoluteTime, Id);

        } catch (err) {
            console.error("sendMessage error:", err);
        }
    };

    // ---------------------------
    // AUTO SCROLL + FOCUS
    // ---------------------------
    useEffect(() => {
        if (messageEl.current) {
            const handler = (event) => {
                const target = event.currentTarget;
                target.scroll({
                    top: target.scrollHeight,
                    behavior: 'smooth'
                });
            };

            messageEl.current.addEventListener('DOMNodeInserted', handler);

            return () => {
                messageEl.current?.removeEventListener('DOMNodeInserted', handler);
            };
        }
    }, []);

    useEffect(() => {
        input.current?.focus();
    }, [currentContactId]);

    // ---------------------------
    // SESSION RETRIEVAL
    // ---------------------------
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

    // ---------------------------
    // SUBMIT MESSAGE
    // ---------------------------
    async function handleSubmit(event) {
        event.preventDefault();

        if (!newMessage.trim()) return;

        console.log("DEBUG contactId:", currentContactId);

        const destLang = getDestLang();

        if (!destLang?.lang) {
            console.error("No language mapping found:", currentContactId);
            return;
        }

        try {
            const translatedMessageAPI = await translateTextAPI(
                newMessage,
                'en',
                destLang.lang
            );

            console.log("Translate API result:", translatedMessageAPI);

            const translatedMessage = translatedMessageAPI?.TranslatedText;

            if (!translatedMessage) {
                console.error("Translation failed:", translatedMessageAPI);
                return;
            }

            const sanitizeText = (text) =>
                typeof text === 'string'
                    ? text
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;')
                        .replace(/'/g, '&#039;')
                    : '';

            const sanitizedNewMessage = sanitizeText(newMessage);
            const sanitizedTranslatedMessage = sanitizeText(translatedMessage);

            // ---------------------------
            // ADD TO CHAT STORE
            // ---------------------------
            addChat(prev => [
                ...prev,
                {
                    contactId: currentContactId,
                    username: agentUsername,
                    content: <p>{sanitizedNewMessage}</p>,
                    translatedMessage: <p>{sanitizedTranslatedMessage}</p>
                }
            ]);

            const session = getSession(currentContactId, props.session);

            if (session) {
                await sendMessage(session, translatedMessage);
            } else {
                console.warn("No session found for contact:", currentContactId);
            }

            setNewMessage("");

        } catch (err) {
            console.error("handleSubmit error:", err);
        }
    }

    // ---------------------------
    // RENDER
    // ---------------------------
    return (
        <div className="chatroom">
            <h3>
                Translate -
                ({languageTranslate.find(l => l.contactId === currentContactId)?.lang || ""})
                {" "}
                {getKeyByValue(languageOptions)}
            </h3>

            <ul className="chats" ref={messageEl}>
                {Chats
                    .filter(chat => chat.contactId === currentContactId)
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
import React, { useEffect, useState, useRef } from 'react';
import { Grid } from 'semantic-ui-react';
import { Amplify } from 'aws-amplify';
import awsconfig from '../aws-exports';
import Chatroom from './chatroom';

import { getConnectConfig } from '../config/getConnectConfig';

import translateText from './translate';
import detectText from './detectText';

import {
    addChat,
    setLanguageTranslate,
    clearChat,
    useGlobalState,
    setCurrentContactId
} from '../store/state';

Amplify.configure(awsconfig);

const Ccp = () => {

    const config = getConnectConfig();

    const connectUrl = config.connectUrl;
    const loginUrl = config.loginUrl;
    const region = config.region;

    const [languageTranslate] = useGlobalState('languageTranslate');
    const [Chats] = useGlobalState('Chats');
    const [lang, setLang] = useState("");
    const [currentContactId] = useGlobalState('currentContactId');
    const [languageOptions] = useGlobalState('languageOptions');

    const [agentChatSessionState, setAgentChatSessionState] = useState([]);
    const [setRefreshChild] = useState([]);

    const ccpInitialized = useRef(false);

    // Keep current global state available inside async callbacks/listeners.
    const languageTranslateRef = useRef([]);
    const processedCustomerMessages = useRef(new Set());

    useEffect(() => {
        languageTranslateRef.current = languageTranslate;
    }, [languageTranslate]);

    function rememberAgentChatSession(contactId, agentChatSession) {
        if (!contactId || !agentChatSession) return;

        setAgentChatSessionState(prev => {
            const exists = prev.some(obj => Object.prototype.hasOwnProperty.call(obj, contactId));
            if (exists) {
                return prev.map(obj =>
                    Object.prototype.hasOwnProperty.call(obj, contactId)
                        ? { [contactId]: agentChatSession }
                        : obj
                );
            }
            return [...prev, { [contactId]: agentChatSession }];
        });
    }

    function getMessageDedupeKey(contactId, content, messageId, timestamp) {
        return `${contactId || ''}|${messageId || ''}|${timestamp || ''}|${content || ''}`;
    }

    function normalizeTranscriptItems(response) {
        // ChatJS wraps GetTranscript response under response.data.Transcript.
        // Some versions / wrappers may expose Transcript directly, so support both.
        return (
            response?.data?.Transcript ||
            response?.Transcript ||
            response?.transcript ||
            response?.data?.transcript ||
            []
        );
    }

    function isCustomerMessage(item) {
        const participantRole = (item.ParticipantRole || item.participantRole || '').toUpperCase();
        const type = (item.Type || item.type || '').toUpperCase();
        const contentType = (item.ContentType || item.contentType || '').toLowerCase();
        const content = item.Content || item.content;

        return (
            participantRole === 'CUSTOMER' &&
            content &&
            (
                type === 'MESSAGE' ||
                contentType === 'text/plain'
            )
        );
    }

    // ---------------------------
    // CHAT EVENT HANDLING
    // ---------------------------
    function getEvents(contact, agentChatSession) {
        contact.getAgentConnection().getMediaController().then(controller => {
            controller.onMessage(messageData => {
                console.log(
                    "MESSAGE RECEIVED",
                    contact.contactId,
                    messageData.data.Content
                );

                console.log("FULL MESSAGE DATA", messageData);
                
                const data = messageData?.data || {};
                const content = data.Content;
                const contactId = data.ContactId || contact.contactId;

                if (!content) return;

                if (messageData.chatDetails.participantId === data.ParticipantId) {
                    console.log("AGENT:", content);
                } else {
                    console.log("CUSTOMER:", content);

                    const key = getMessageDedupeKey(
                        contactId,
                        content,
                        data.Id,
                        data.AbsoluteTime
                    );

                    if (processedCustomerMessages.current.has(key)) return;
                    processedCustomerMessages.current.add(key);

                    processChatText(
                        content,
                        data.Type || 'MESSAGE',
                        contactId
                    );
                }
            });
        });
    }

    async function processExistingTranscript(contact, agentChatSession, attempt = 1) {
        if (!agentChatSession || typeof agentChatSession.getTranscript !== 'function') {
            console.warn("Chat session does not expose getTranscript; skipping startup transcript processing.");
            return;
        }

        try {
            console.log(`Loading existing chat transcript for ${contact.contactId}. Attempt ${attempt}`);

            const response = await agentChatSession.getTranscript({
                maxResults: 100,
                scanDirection: "BACKWARD",
                sortOrder: "ASCENDING"
            });

            const transcript = normalizeTranscriptItems(response);
            console.log("Existing transcript items found:", transcript.length, response);

            let processedAny = false;

            for (const item of transcript) {
                if (!isCustomerMessage(item)) continue;

                const content = item.Content || item.content;
                const contactId = item.ContactId || item.contactId || contact.contactId;
                const messageId = item.Id || item.id;
                const timestamp = item.AbsoluteTime || item.absoluteTime;
                const type = item.Type || item.type || 'MESSAGE';

                const key = getMessageDedupeKey(contactId, content, messageId, timestamp);
                if (processedCustomerMessages.current.has(key)) continue;
                processedCustomerMessages.current.add(key);

                processedAny = true;
                await processChatText(content, type, contactId);
            }

            // Sometimes transcript is not immediately hydrated when the agent connection first opens.
            // Retry briefly so messages sent before agent accept are picked up without waiting for a new customer message.
            if (!processedAny && attempt < 5) {
                setTimeout(() => processExistingTranscript(contact, agentChatSession, attempt + 1), 1000);
            }
        } catch (err) {
            console.warn("Unable to process existing transcript:", err);

            if (attempt < 5) {
                setTimeout(() => processExistingTranscript(contact, agentChatSession, attempt + 1), 1000);
            }
        }
    }

    async function initializeChatContact(contact) {
        try {
            const cnn = contact
                .getConnections()
                .find(c => c.getType() === window.connect.ConnectionType.AGENT);

            if (!cnn) {
                console.warn("No agent connection found for contact:", contact.contactId);
                return;
            }

            const agentChatSession = await cnn.getMediaController();

            setCurrentContactId(contact.contactId);
            rememberAgentChatSession(contact.contactId, agentChatSession);
            getEvents(contact, agentChatSession);
            processExistingTranscript(contact, agentChatSession);
        } catch (err) {
            console.error("initializeChatContact error:", err);
        }
    }

    // ---------------------------
    // PROCESS INCOMING CHAT
    // ---------------------------
    async function processChatText(content, type, contactId) {

        if (!content || !contactId) return;

        let textLang = '';

        const languageMap = [...languageTranslateRef.current];

        for (let i = 0; i < languageMap.length; i++) {
            if (languageMap[i].contactId === contactId) {
                textLang = languageMap[i].lang;
                break;
            }
        }

        if (!textLang) {
            let tempLang = await detectText(content);
            textLang = tempLang.textInterpretation.language;
        }

        const updated = {
            contactId,
            lang: textLang
        };

        const exists = languageMap.findIndex(x => x.contactId === contactId);

        if (exists > -1) languageMap[exists] = updated;
        else languageMap.push(updated);

        languageTranslateRef.current = languageMap;
        setLanguageTranslate([...languageMap]);

        const translatedMessage = await translateText(content, textLang, 'en');

        addChat(prev => [
            ...prev,
            {
                contactId,
                username: 'customer',
                content,
                translatedMessage
            }
        ]);
    }

    // ---------------------------
    // CONNECT EVENT SUBSCRIPTION
    // ---------------------------
    function subscribeConnectEvents() {

        window.connect.core.onViewContact((event) => {
            setCurrentContactId(event.contactId);
        });

        if (window.connect.ChatSession) {

            window.connect.contact(contact => {

                contact.onAccepted(async () => {
                    await initializeChatContact(contact);
                });

                contact.onConnected(async () => {
                    await initializeChatContact(contact);
                });

                contact.onRefresh(() => {
                    console.log("Refresh:", contact.contactId);
                });

                contact.onDestroy(() => {
                    clearChat();
                    setCurrentContactId('');
                });
            });

        } else {
            setTimeout(subscribeConnectEvents, 3000);
        }
    }

    // ---------------------------
    // INIT CCP
    // ---------------------------
    useEffect(() => {

        if (ccpInitialized.current) return;
        if (!connectUrl) return;

        ccpInitialized.current = true;

        window.connect.core.initCCP(
            document.getElementById("ccp-container"),
            {
                ccpUrl: connectUrl + "/ccp-v2/softphone",
                region,
                loginPopup: true,
                loginPopupAutoClose: true,
                //loginUrl: connectUrl + "/login",
                loginUrl,

                softphone: {
                    allowFramedSoftphone: true,
                    allowEarlyGum: true,
                    disableRingtone: false
                },

                pageOptions: {
                    enableAudioDeviceSettings: true,
                    enablePhoneTypeSettings: true,
                    enableVideoDeviceSettings: true
                }
            }
        );

        subscribeConnectEvents();

    }, []);

    return (
        <main>
            <Grid columns='equal' stackable padded>

                <Grid.Row>

                    <div id="ccp-container"></div>

                    <div id="chatroom">
                        <Chatroom session={agentChatSessionState} />
                    </div>

                </Grid.Row>

            </Grid>
        </main>
    );
};

export default Ccp;

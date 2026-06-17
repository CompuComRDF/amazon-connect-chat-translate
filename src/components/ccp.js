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
    const region = config.region;

    const [languageTranslate] = useGlobalState('languageTranslate');
    const [Chats] = useGlobalState('Chats');
    const [lang, setLang] = useState("");
    const [currentContactId] = useGlobalState('currentContactId');
    const [languageOptions] = useGlobalState('languageOptions');

    const [agentChatSessionState, setAgentChatSessionState] = useState([]);
    const [setRefreshChild] = useState([]);

    const ccpInitialized = useRef(false);
    const processedCustomerMessages = useRef(new Set());
    const languageTranslateRef = useRef([]);

    useEffect(() => {
        languageTranslateRef.current = languageTranslate;
    }, [languageTranslate]);

    function rememberAgentChatSession(contactId, agentChatSession) {
        setAgentChatSessionState(prev => {
            const exists = prev.some(obj => Object.prototype.hasOwnProperty.call(obj, contactId));
            if (exists) {
                return prev.map(obj => Object.prototype.hasOwnProperty.call(obj, contactId) ? { [contactId]: agentChatSession } : obj);
            }
            return [...prev, { [contactId]: agentChatSession }];
        });
    }

    function getMessageDedupeKey(contactId, content, messageId, timestamp) {
        return `${contactId}|${messageId || timestamp || ''}|${content}`;
    }

    // ---------------------------
    // CHAT EVENT HANDLING
    // ---------------------------
    function getEvents(contact, agentChatSession) {
        contact.getAgentConnection().getMediaController().then(controller => {
            controller.onMessage(messageData => {

                if (messageData.chatDetails.participantId === messageData.data.ParticipantId) {
                    console.log("AGENT:", messageData.data.Content);
                } else {
                    console.log("CUSTOMER:", messageData.data.Content);

                    const key = getMessageDedupeKey(
                        messageData.data.ContactId,
                        messageData.data.Content,
                        messageData.data.Id,
                        messageData.data.AbsoluteTime
                    );

                    if (processedCustomerMessages.current.has(key)) return;
                    processedCustomerMessages.current.add(key);

                    processChatText(
                        messageData.data.Content,
                        messageData.data.Type,
                        messageData.data.ContactId
                    );
                }
            });
        });
    }

    async function processExistingTranscript(contact, agentChatSession) {
        if (!agentChatSession || typeof agentChatSession.getTranscript !== 'function') {
            console.warn("Chat session does not expose getTranscript; skipping startup transcript processing.");
            return;
        }

        try {
            const response = await agentChatSession.getTranscript({
                scanDirection: "BACKWARD",
                sortOrder: "ASCENDING",
                maxResults: 100
            });

            const transcript = response?.Transcript || response?.transcript || [];

            for (const item of transcript) {
                const participantRole = item.ParticipantRole || item.participantRole;
                const type = item.Type || item.type;
                const content = item.Content || item.content;
                const contactId = item.ContactId || item.contactId || contact.contactId;
                const messageId = item.Id || item.id;
                const timestamp = item.AbsoluteTime || item.absoluteTime;

                if (participantRole !== "CUSTOMER") continue;
                if (type !== "MESSAGE") continue;
                if (!content) continue;

                const key = getMessageDedupeKey(contactId, content, messageId, timestamp);
                if (processedCustomerMessages.current.has(key)) continue;
                processedCustomerMessages.current.add(key);

                await processChatText(content, type, contactId);
            }
        } catch (err) {
            console.warn("Unable to process existing transcript:", err);
        }
    }

    // ---------------------------
    // PROCESS INCOMING CHAT
    // ---------------------------
    async function processChatText(content, type, contactId) {

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

                    const cnn = contact
                        .getConnections()
                        .find(c => c.getType() === window.connect.ConnectionType.AGENT);

                    const agentChatSession = await cnn.getMediaController();

                    setCurrentContactId(contact.contactId);

                    rememberAgentChatSession(contact.contactId, agentChatSession);
                });

                contact.onConnected(async () => {
                    const cnn = contact
                        .getConnections()
                        .find(c => c.getType() === window.connect.ConnectionType.AGENT);

                    const agentChatSession = await cnn.getMediaController();

                    setCurrentContactId(contact.contactId);
                    rememberAgentChatSession(contact.contactId, agentChatSession);
                    getEvents(contact, agentChatSession);
                    await processExistingTranscript(contact, agentChatSession);
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

        //window.connect.agentApp.initApp(
        //    "ccp",
        //    "ccp-container",
        //    //connectUrl + "/connect/ccp-v2/",
        //    connectUrl + "/ccp-v2/",
        //    {
        //        ccpParams: {
        //            region,
        //            loginPopup: true,
        //            loginPopupAutoClose: true,
        //            //loginUrl: connectUrl + "/connect/login",
        //            loginUrl: connectUrl + "/login",
        //            softphone: {
        //                allowFramedSoftphone: true,
        //                allowEarlyGum: true,
        //                disableRingtone: false,
        //                allowMicrophoneAccess: true,
        //                allowVideoDeviceAccess: true
        //            },

        //            pageOptions: {
        //                enableAudioDeviceSettings: true,
        //                enablePhoneTypeSettings: true,
        //                enableVideoDeviceSettings: true
        //            }                    
        //        }
        //    }
        //);

        window.connect.core.initCCP(
            document.getElementById("ccp-container"),
            {
                ccpUrl: connectUrl + "/ccp-v2/softphone",
                region,
                loginPopup: true,
                loginPopupAutoClose: true,
                loginUrl: connectUrl + "/login",

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
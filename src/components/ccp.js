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
                    processChatText(
                        messageData.data.Content,
                        messageData.data.Type,
                        messageData.data.ContactId
                    );
                }
            });
        });
    }

    // ---------------------------
    // PROCESS INCOMING CHAT
    // ---------------------------
    async function processChatText(content, type, contactId) {

        let textLang = '';

        for (let i = 0; i < languageTranslate.length; i++) {
            if (languageTranslate[i].contactId === contactId) {
                textLang = languageTranslate[i].lang;
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

        const exists = languageTranslate.findIndex(x => x.contactId === contactId);

        if (exists > -1) languageTranslate[exists] = updated;
        else languageTranslate.push(updated);

        setLanguageTranslate([...languageTranslate]);

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

                    setAgentChatSessionState(prev => [
                        ...prev,
                        { [contact.contactId]: agentChatSession }
                    ]);
                });

                contact.onConnected(async () => {
                    const cnn = contact
                        .getConnections()
                        .find(c => c.getType() === window.connect.ConnectionType.AGENT);

                    const agentChatSession = await cnn.getMediaController();

                    getEvents(contact, agentChatSession);
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

        window.connect.agentApp.initApp(
            "ccp",
            "ccp-container",
            connectUrl + "/connect/ccp-v2/",
            {
                ccpParams: {
                    region,
                    loginPopup: true,
                    loginPopupAutoClose: true,
                    loginUrl: connectUrl + "/connect/login",
                    softphone: {
                        allowFramedSoftphone: true,
                        disableRingtone: false
                    }
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
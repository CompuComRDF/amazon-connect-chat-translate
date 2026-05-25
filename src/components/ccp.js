import React, { useEffect, useState, useRef } from 'react';
import { Grid } from 'semantic-ui-react';
import { Amplify } from 'aws-amplify';
import awsconfig from '../aws-exports';

import Chatroom from './chatroom';
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
    const [languageTranslate] = useGlobalState('languageTranslate');
    const [Chats] = useGlobalState('Chats');
    const [languageOptions] = useGlobalState('languageOptions');
    const [agentChatSessionState, setAgentChatSessionState] = useState([]);

    const ccpInitialized = useRef(false);
    const subscriptionInitialized = useRef(false);

    // -------------------------
    // CHAT PROCESSING
    // -------------------------
    async function processChatText(content, type, contactId) {
        console.log(type);

        let textLang = '';

        // find cached language
        for (let i = 0; i < languageTranslate.length; i++) {
            if (languageTranslate[i].contactId === contactId) {
                textLang = languageTranslate[i].lang;
                break;
            }
        }

        // fallback detection
        if (!textLang) {
            const tempLang = await detectText(content);
            textLang = tempLang?.textInterpretation?.language || 'en';
        }

        // immutably update language store
        const updated = [...languageTranslate];
        const existingIndex = updated.findIndex(x => x.contactId === contactId);

        if (existingIndex > -1) {
            updated[existingIndex] = { contactId, lang: textLang };
        } else {
            updated.push({ contactId, lang: textLang });
        }

        setLanguageTranslate(updated);

        const translatedMessage = await translateText(content, textLang, 'en');

        const sanitizeText = (text) =>
            typeof text === 'string'
                ? text
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#039;')
                : '';

        const data = {
            contactId,
            username: 'customer',
            content: <p>{sanitizeText(content)}</p>,
            translatedMessage: <p>{sanitizeText(translatedMessage)}</p>
        };

        addChat(prev => [...prev, data]);
    }

    // -------------------------
    // CHAT EVENTS
    // -------------------------
    function getEvents(contact) {
        const connection = contact.getAgentConnection();

        if (!connection) return;

        connection.getMediaController()
            .then(controller => {
                controller.onMessage(messageData => {
                    const isAgent =
                        messageData.chatDetails.participantId ===
                        messageData.data.ParticipantId;

                    if (!isAgent) {
                        processChatText(
                            messageData.data.Content,
                            messageData.data.Type,
                            messageData.data.ContactId
                        );
                    }
                })
                .catch(err => console.warn('MediaController error', err));
            })
            .catch(err => console.warn('getMediaController error', err));
    }

    // -------------------------
    // SUBSCRIBE CONNECT EVENTS
    // -------------------------
    function subscribeConnectEvents() {
        if (subscriptionInitialized.current) return;
        subscriptionInitialized.current = true;

        if (!window.connect) {
            subscriptionInitialized.current = false;
            setTimeout(subscribeConnectEvents, 1000);
            return;
        }

        window.connect.core.onViewContact(event => {
            setCurrentContactId(event.contactId);
        });

        window.connect.contact(contact => {

            contact.onConnecting(() => {
                console.log('onConnecting', contact.contactId);
            });

            contact.onAccepted(async () => {
                setCurrentContactId(contact.contactId);

                const cnn = contact.getConnections()?.find(
                    c => c.getType() === window.connect.ConnectionType.AGENT
                );

                if (!cnn) return;

                try {
                    const session = await cnn.getMediaController();

                    setAgentChatSessionState(prev => [
                        ...prev,
                        { [contact.contactId]: session }
                    ]);
                } catch (e) {
                    console.warn('MediaController not ready', e);
                }
            });

            contact.onConnected(() => {
                getEvents(contact);
            });

            contact.onDestroy(() => {
                setCurrentContactId('');
                clearChat();
            });
        });

        window.connect.agent(agent => {
            agent.onStateChange(state => {
                console.log('Agent state:', state.newState);
            });
        });
    }

    // -------------------------
    // INIT CCP (SSO)
    // -------------------------
    useEffect(() => {
        if (ccpInitialized.current) return;
        ccpInitialized.current = true;

        const connectUrl = process.env.REACT_APP_CONNECT_INSTANCE_URL;
        const region = process.env.REACT_APP_CONNECT_REGION || 'us-east-1';

        const validUrl =
            /^https:\/\/[\w-]+\.(awsapps\.com|my\.connect\.aws)(\/.*)?$/;

        if (!connectUrl || !validUrl.test(connectUrl)) {
            console.error('Invalid Connect URL');
            return;
        }

        window.connect.agentApp.initApp(
            "ccp",
            "ccp-container",
            `${connectUrl}/connect/ccp-v2/`,
            {
                ccpParams: {
                    region,
                    loginPopup: true,
                    loginPopupAutoClose: true,
                    loginUrl: `${connectUrl}/connect/login`,
                    softphone: {
                        allowFramedSoftphone: true,
                        disableRingtone: false
                    },
                    pageOptions: {
                        enableAudioDeviceSettings: true,
                        enablePhoneTypeSettings: true
                    }
                }
            }
        );

        const waitForConnect = setInterval(() => {
            if (window.connect?.contact && window.connect?.agent) {
                clearInterval(waitForConnect);
                subscribeConnectEvents();
            }
        }, 500);

    }, []);

    // -------------------------
    // UI
    // -------------------------
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

import React, { useEffect, useState, useRef } from 'react';
import { Grid } from 'semantic-ui-react';
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

const Ccp = () => {
    const [agentChatSessionState, setAgentChatSessionState] = useState([]);
    const ccpInitialized = useRef(false);

    const [languageTranslate] = useGlobalState('languageTranslate');
    const [languageOptions] = useGlobalState('languageOptions');

    const connectUrl = process.env.REACT_APP_CONNECT_INSTANCE_URL;
    const region = process.env.REACT_APP_CONNECT_REGION || 'us-east-1';

    // -----------------------------
    // FALLBACK LOADER
    // -----------------------------
    const launchCCP = () => {
        try {
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

            subscribeConnectEvents();

        } catch (err) {
            console.warn("CCP iframe blocked — opening popup fallback", err);

            window.open(
                `${connectUrl}/connect/ccp-v2/`,
                "_blank"
            );
        }
    };

    // -----------------------------
    // CONNECT EVENTS
    // -----------------------------
    function subscribeConnectEvents() {
        window.connect.core.onViewContact(event => {
            setCurrentContactId(event.contactId);
        });

        if (window.connect.ChatSession) {
            window.connect.contact(contact => {

                contact.onAccepted(async () => {
                    const cnn = contact.getConnections()
                        .find(c => c.getType() === window.connect.ConnectionType.AGENT);

                    const agentChatSession = await cnn.getMediaController();

                    setAgentChatSessionState(prev => [
                        ...prev,
                        { [contact.contactId]: agentChatSession }
                    ]);
                });

                contact.onConnected(async () => {
                    const cnn = contact.getConnections()
                        .find(c => c.getType() === window.connect.ConnectionType.AGENT);

                    const agentChatSession = await cnn.getMediaController();
                    console.log("CCP connected", agentChatSession);
                });

                contact.onDestroy(() => {
                    setCurrentContactId('');
                    clearChat();
                });
            });
        }
    }

    // -----------------------------
    // INIT
    // -----------------------------
    useEffect(() => {
        if (ccpInitialized.current) return;
        ccpInitialized.current = true;

        launchCCP();

        // safety check for iframe failure (Edge fix)
        setTimeout(() => {
            const iframe = document.querySelector("#ccp-container iframe");

            if (!iframe) {
                console.warn("CCP iframe missing — fallback triggered");

                window.open(
                    `${connectUrl}/connect/ccp-v2/`,
                    "_blank"
                );
            }
        }, 8000);

    }, []);

    return (
        <main>
            <Grid columns="equal" stackable padded>
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

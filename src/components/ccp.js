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
    const [agentChatSessionState, setAgentChatSessionState] = useState([]);

    const ccpInitialized = useRef(false);

    // Keep current global state available inside async callbacks/listeners.
    const languageTranslateRef = useRef([]);

    // Contact/session safeguards.
    const contactRef = useRef(new Map());
    const initializedContacts = useRef(new Set());
    const contactEventListeners = useRef(new Set());

    // Message safeguards. A message is only marked processed AFTER translation/rendering succeeds.
    const processingCustomerMessages = useRef(new Set());
    const processedCustomerMessages = useRef(new Set());

    useEffect(() => {
        languageTranslateRef.current = languageTranslate;
    }, [languageTranslate]);

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // The hosted chat page can pass locale-style values while Amazon Translate uses a
    // mixture of base language codes and supported regional variants.
    const normalizeLanguageCode = (language) => {
        if (!language) return '';

        const value = String(language).trim();
        const lower = value.toLowerCase();

        const aliases = {
            'en-us': 'en',
            'pt-br': 'pt',
            'cs-cz': 'cs',
            'da-dk': 'da',
            'de-de': 'de',
            'nl-nl': 'nl',
            'fi-fi': 'fi',
            'it-it': 'it',
            'nb-no': 'no',
            'pl-pl': 'pl',
            'ro-ro': 'ro',
            'sv-se': 'sv',
            'tr-tr': 'tr',
            'arb': 'ar',
            'fr-ca': 'fr-CA',
            'es-mx': 'es-MX',
            'zh-tw': 'zh-TW',
            'fa-af': 'fa-AF',
            'pt-pt': 'pt-PT'
        };

        return aliases[lower] || lower;
    };

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

    function getContactLanguage(contactId) {
        return languageTranslateRef.current.find(x => x.contactId === contactId)?.lang || '';
    }

    function setContactLanguage(contactId, language, source = 'unknown') {
        if (!contactId || !language) return '';

        const normalizedLanguage = normalizeLanguageCode(language);
        if (!normalizedLanguage) return '';

        // Always build from the LATEST ref value. This prevents concurrent chats from
        // overwriting one another after an async language detection/translation call.
        const languageMap = [...languageTranslateRef.current];
        const index = languageMap.findIndex(x => x.contactId === contactId);
        const updated = { contactId, lang: normalizedLanguage };

        if (index > -1) languageMap[index] = updated;
        else languageMap.push(updated);

        languageTranslateRef.current = languageMap;
        setLanguageTranslate([...languageMap]);

        console.log(`Language for ${contactId}: ${normalizedLanguage} (${source})`);
        return normalizedLanguage;
    }

    function getAttributeValue(attributes, candidateNames) {
        if (!attributes) return '';

        for (const candidateName of candidateNames) {
            const direct = attributes[candidateName];
            if (direct !== undefined && direct !== null) {
                if (typeof direct === 'string') return direct;
                if (direct.value !== undefined) return direct.value;
                if (direct.Value !== undefined) return direct.Value;
            }
        }

        // Be tolerant of capitalization differences in custom attributes.
        const normalizedCandidates = candidateNames.map(name => name.toLowerCase());
        for (const [key, attribute] of Object.entries(attributes)) {
            const attributeName = String(attribute?.name || attribute?.Name || key).toLowerCase();
            if (!normalizedCandidates.includes(attributeName)) continue;

            if (typeof attribute === 'string') return attribute;
            if (attribute?.value !== undefined) return attribute.value;
            if (attribute?.Value !== undefined) return attribute.Value;
        }

        return '';
    }

    function getConfiguredLanguage(contact) {
        try {
            if (!contact || typeof contact.getAttributes !== 'function') return '';

            const attributes = contact.getAttributes();
            const language = getAttributeValue(attributes, [
                'HostedWidget-language',
                'language',
                'Language',
                'connect:Language'
            ]);

            return normalizeLanguageCode(language);
        } catch (err) {
            console.warn('Unable to read contact language attributes:', err);
            return '';
        }
    }

    async function hydrateConfiguredLanguage(contact, attempts = 6) {
        if (!contact?.contactId) return '';

        for (let attempt = 1; attempt <= attempts; attempt++) {
            const language = getConfiguredLanguage(contact);
            if (language) {
                return setContactLanguage(contact.contactId, language, 'contact attribute');
            }

            if (attempt < attempts) {
                await sleep(150 * attempt);
            }
        }

        return '';
    }

    async function detectLanguageWithRetry(content, attempts = 3) {
        let lastError;

        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                const result = await detectText(content);
                const language = normalizeLanguageCode(result?.textInterpretation?.language);

                if (language) return language;
                lastError = new Error('Language detection returned no language.');
            } catch (err) {
                lastError = err;
            }

            if (attempt < attempts) await sleep(250 * attempt);
        }

        throw lastError || new Error('Unable to detect message language.');
    }

    async function translateWithRetry(content, sourceLanguage, targetLanguage = 'en', attempts = 3) {
        if (normalizeLanguageCode(sourceLanguage) === normalizeLanguageCode(targetLanguage)) {
            return content;
        }

        let lastError;

        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                const translated = await translateText(content, sourceLanguage, targetLanguage);
                if (typeof translated === 'string' && translated.length > 0) return translated;

                lastError = new Error('Translation returned an empty response.');
            } catch (err) {
                lastError = err;
            }

            console.warn(
                `Translation attempt ${attempt} failed for ${sourceLanguage} -> ${targetLanguage}:`,
                lastError
            );

            if (attempt < attempts) await sleep(300 * attempt);
        }

        throw lastError || new Error('Unable to translate message.');
    }

    async function resolveLanguageForMessage(contactId, content) {
        // 1) Existing contact mapping is preferred.
        let language = getContactLanguage(contactId);
        if (language) return language;

        // 2) The language attribute passed by the hosted chat page is authoritative.
        // Give Streams a very short window to hydrate attributes before falling back.
        const contact = contactRef.current.get(contactId);
        if (contact) {
            language = await hydrateConfiguredLanguage(contact, 3);
            if (language) return language;
        }

        // 3) Legacy/fallback behavior for chats that do not provide a language attribute.
        language = await detectLanguageWithRetry(content);

        // An attribute may have arrived while detection was running. If it did, use it.
        const authoritativeLanguage = getContactLanguage(contactId);
        if (authoritativeLanguage) return authoritativeLanguage;

        return setContactLanguage(contactId, language, 'language detection');
    }

    // ---------------------------
    // PROCESS INCOMING CHAT
    // ---------------------------
    async function processChatText(content, type, contactId) {
        if (!content || !contactId) return false;

        const textLang = await resolveLanguageForMessage(contactId, content);
        const translatedMessage = await translateWithRetry(content, textLang, 'en');

        addChat(prev => [
            ...prev,
            {
                contactId,
                username: 'customer',
                content,
                translatedMessage
            }
        ]);

        return true;
    }

    async function processCustomerMessageOnce({
        contactId,
        content,
        messageId,
        timestamp,
        type = 'MESSAGE'
    }) {
        if (!contactId || !content) return false;

        const key = getMessageDedupeKey(contactId, content, messageId, timestamp);

        if (processedCustomerMessages.current.has(key)) return true;
        if (processingCustomerMessages.current.has(key)) return false;

        processingCustomerMessages.current.add(key);

        try {
            const processed = await processChatText(content, type, contactId);
            if (processed) processedCustomerMessages.current.add(key);
            return processed;
        } catch (err) {
            // Do NOT mark the message processed on failure. Startup transcript sync can retry it.
            console.error('Unable to process/translate customer message:', err, {
                contactId,
                messageId,
                content
            });
            return false;
        } finally {
            processingCustomerMessages.current.delete(key);
        }
    }

    // ---------------------------
    // CHAT EVENT HANDLING
    // ---------------------------
    async function getEvents(contact, agentChatSession) {
        if (!contact?.contactId || contactEventListeners.current.has(contact.contactId)) return;

        try {
            const controller = agentChatSession || await contact.getAgentConnection().getMediaController();
            if (!controller) return;

            contactEventListeners.current.add(contact.contactId);

            controller.onMessage(async messageData => {
                const data = messageData?.data || {};
                const content = data.Content;
                const contactId = data.ContactId || contact.contactId;

                if (!content) return;

                console.log('MESSAGE RECEIVED', contactId, content);
                console.log('FULL MESSAGE DATA', messageData);

                const participantRole = (data.ParticipantRole || '').toUpperCase();
                const agentParticipantId = messageData?.chatDetails?.participantId;
                const isAgentMessage = participantRole === 'AGENT' ||
                    (agentParticipantId && agentParticipantId === data.ParticipantId);

                if (isAgentMessage) {
                    console.log('AGENT:', content);
                    return;
                }

                // If ParticipantRole is present, only process CUSTOMER messages.
                if (participantRole && participantRole !== 'CUSTOMER') return;

                console.log('CUSTOMER:', content);

                await processCustomerMessageOnce({
                    contactId,
                    content,
                    messageId: data.Id,
                    timestamp: data.AbsoluteTime,
                    type: data.Type || 'MESSAGE'
                });
            });
        } catch (err) {
            console.error('Unable to subscribe to chat message events:', err);
        }
    }

    async function processExistingTranscript(contact, agentChatSession, attempt = 1) {
        if (!agentChatSession || typeof agentChatSession.getTranscript !== 'function') {
            console.warn('Chat session does not expose getTranscript; skipping startup transcript processing.');
            return;
        }

        try {
            console.log(`Loading existing chat transcript for ${contact.contactId}. Attempt ${attempt}`);

            const response = await agentChatSession.getTranscript({
                maxResults: 100,
                scanDirection: 'BACKWARD',
                sortOrder: 'ASCENDING'
            });

            const transcript = normalizeTranscriptItems(response);
            console.log('Existing transcript items found:', transcript.length, response);

            for (const item of transcript) {
                if (!isCustomerMessage(item)) continue;

                await processCustomerMessageOnce({
                    contactId: item.ContactId || item.contactId || contact.contactId,
                    content: item.Content || item.content,
                    messageId: item.Id || item.id,
                    timestamp: item.AbsoluteTime || item.absoluteTime,
                    type: item.Type || item.type || 'MESSAGE'
                });
            }
        } catch (err) {
            console.warn('Unable to process existing transcript:', err);
        }

        // Always perform a few short startup re-syncs. The transcript can hydrate after
        // the agent connection opens; dedupe guards make these retries safe.
        if (attempt < 5 && initializedContacts.current.has(contact.contactId)) {
            setTimeout(
                () => processExistingTranscript(contact, agentChatSession, attempt + 1),
                750 * attempt
            );
        }
    }

    async function initializeChatContact(contact) {
        if (!contact?.contactId) return;

        contactRef.current.set(contact.contactId, contact);

        // Read the customer-selected language as early as possible. This also runs before
        // the media session is ready, so the language label can be correct immediately.
        hydrateConfiguredLanguage(contact).catch(err =>
            console.warn('Unable to hydrate contact language:', err)
        );

        if (initializedContacts.current.has(contact.contactId)) return;

        try {
            const cnn = contact
                .getConnections()
                .find(c => c.getType() === window.connect.ConnectionType.AGENT);

            if (!cnn) {
                console.log('Agent connection not ready yet for:', contact.contactId);
                return;
            }

            const agentChatSession = await cnn.getMediaController();
            if (!agentChatSession) return;

            // Mark initialized only after the media controller exists.
            initializedContacts.current.add(contact.contactId);

            setCurrentContactId(contact.contactId);
            rememberAgentChatSession(contact.contactId, agentChatSession);

            await getEvents(contact, agentChatSession);

            // Start transcript translation immediately. Do not wait for a future customer
            // message to trigger the translation panel.
            processExistingTranscript(contact, agentChatSession);
        } catch (err) {
            console.error('initializeChatContact error:', err);
        }
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
                contactRef.current.set(contact.contactId, contact);

                // Try immediately so contact attributes can be read before acceptance and,
                // where the media controller is already available, translation can start now.
                initializeChatContact(contact);

                contact.onAccepted(async () => {
                    await initializeChatContact(contact);
                });

                contact.onConnected(async () => {
                    await initializeChatContact(contact);
                });

                contact.onRefresh(() => {
                    console.log('Refresh:', contact.contactId);
                    contactRef.current.set(contact.contactId, contact);

                    // Re-read authoritative attributes on refresh without depending on the refresh
                    // to fix state. Normally this simply confirms the existing language.
                    hydrateConfiguredLanguage(contact).catch(err =>
                        console.warn('Unable to refresh contact language:', err)
                    );
                });

                contact.onDestroy(() => {
                    initializedContacts.current.delete(contact.contactId);
                    contactEventListeners.current.delete(contact.contactId);
                    contactRef.current.delete(contact.contactId);

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
            document.getElementById('ccp-container'),
            {
                ccpUrl: connectUrl + '/ccp-v2/softphone',
                region,
                loginPopup: true,
                loginPopupAutoClose: true,
                //loginUrl: connectUrl + '/login',
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

                    <div id='ccp-container'></div>

                    <div id='chatroom'>
                        <Chatroom session={agentChatSessionState} />
                    </div>

                </Grid.Row>

            </Grid>
        </main>
    );
};

export default Ccp;

import React from 'react';
import ReactDOM from 'react-dom';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import "amazon-connect-streams";
import "amazon-connect-chatjs";

import 'semantic-ui-less/semantic.less';

import { Amplify } from "aws-amplify";
import awsExports from "./aws-exports";

Amplify.configure(awsExports);

if (window.__CCP_LAUNCHER_MODE__) {
  const params = new URLSearchParams(window.location.search);
  const instance = params.get("instance") || "uatrdf-genesysdr";
  const region = params.get("region") || "us-east-1";

  const ssoUrls = {
    "uatrdf-genesysdr": "https://account.activedirectory.windowsazure.com/applications/signin/3d1e37fc-6119-4055-921a-6fae7e40c2f6?tenantId=fa462fb8-0560-430e-8331-6a29355f95ca",
    "prodrdf-genesysdr": "https://account.activedirectory.windowsazure.com/applications/signin/99a68e1b-b1f9-4e73-b185-92a5f0567646?tenantId=fa462fb8-0560-430e-8331-6a29355f95ca"
  };

  const ssoUrl = ssoUrls[instance];
  const ccpUrl = `/?instance=${encodeURIComponent(instance)}&region=${encodeURIComponent(region)}`;

  document.getElementById('root').innerHTML = `
    <div style="font-family: Arial, sans-serif; padding: 40px;">
      <h2>Launching Amazon Connect...</h2>
      <p>Complete the Amazon Connect login. This page will continue when the login window closes.</p>
      <button id="continue">Continue to CCP</button>
    </div>
  `;

  let ssoWindow = null;

  function openSsoWindow() {
    ssoWindow = window.open(ssoUrl, "connect_sso", "width=1100,height=800");
  }

  openSsoWindow();

  const checkClosed = setInterval(() => {
    if (ssoWindow && ssoWindow.closed) {
      clearInterval(checkClosed);
      window.location.href = ccpUrl;
    }
  }, 1000);

  document.getElementById("continue").onclick = () => {
    if (ssoWindow && !ssoWindow.closed) {
      ssoWindow.close();
    }

    clearInterval(checkClosed);
    window.location.href = ccpUrl;
  };

} else {
  ReactDOM.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
    document.getElementById('root')
  );

  reportWebVitals();
}
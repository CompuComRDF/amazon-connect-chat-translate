import React from 'react';
import ReactDOM from 'react-dom';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import "amazon-connect-streams";
import "amazon-connect-chatjs";

// Import semantic
import 'semantic-ui-less/semantic.less';

// Amplify imports for base install
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
    <div style="
      min-height: 100vh;
      background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: Arial, sans-serif;
      color: #111827;
    ">
      <div style="
        width: 420px;
        background: #ffffff;
        border-radius: 12px;
        padding: 30px;
        box-shadow: 0 12px 35px rgba(0,0,0,0.35);
        text-align: center;
      ">
        <div style="
          width: 52px;
          height: 52px;
          margin: 0 auto 18px auto;
          border-radius: 50%;
          background: #0ea5e9;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-size: 26px;
          font-weight: bold;
        ">
          ↗
        </div>

        <h2 style="margin: 0 0 10px 0;">Launching Amazon Connect</h2>

        <p id="launcherMessage" style="
          margin: 0 0 20px 0;
          color: #4b5563;
          font-size: 14px;
          line-height: 1.5;
        ">
          Complete the Microsoft sign-in in the popup window. Once complete, click Continue.
        </p>

        <div id="spinner" style="
          width: 34px;
          height: 34px;
          margin: 0 auto 22px auto;
          border: 4px solid #e5e7eb;
          border-top: 4px solid #0ea5e9;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        "></div>

        <button id="continue" disabled style="
          width: 100%;
          padding: 12px;
          border: none;
          border-radius: 8px;
          background: #9ca3af;
          color: white;
          font-size: 15px;
          font-weight: bold;
          cursor: not-allowed;
        ">
          Preparing login...
        </button>

        <button id="reopenLogin" style="
          width: 100%;
          margin-top: 12px;
          padding: 10px;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          background: white;
          color: #374151;
          font-size: 14px;
          cursor: pointer;
        ">
          Reopen login window
        </button>
      </div>
    </div>

    <style>
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    </style>
  `;

  let ssoWindow = null;

  function openSsoWindow() {
    const width = 640;
    const height = 680;
    const left = Math.max(0, window.screenX + ((window.outerWidth - width) / 2));
    const top = Math.max(0, window.screenY + ((window.outerHeight - height) / 2));

    ssoWindow = window.open(
      ssoUrl,
      "connect_sso",
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );
  }

  function enableContinue() {
    const continueButton = document.getElementById("continue");
    const message = document.getElementById("launcherMessage");
    const spinner = document.getElementById("spinner");

    continueButton.disabled = false;
    continueButton.innerText = "Continue to CCP";
    continueButton.style.background = "#16a34a";
    continueButton.style.cursor = "pointer";

    message.innerText = "After the Amazon Connect window shows you are signed in, click Continue to open the custom CCP.";

    spinner.style.display = "none";
  }

  openSsoWindow();

  setTimeout(enableContinue, 3000);

  document.getElementById("reopenLogin").onclick = () => {
    openSsoWindow();
    setTimeout(enableContinue, 1500);
  };

  document.getElementById("continue").onclick = () => {
    if (ssoWindow && !ssoWindow.closed) {
      ssoWindow.close();
    }

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
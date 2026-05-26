import React from 'react';

const Message = ({ chat, user }) => (
    <li className={`chat ${user === chat.username ? "right" : "left"}`}>

        <div className="messageContent">
            {chat.content}
        </div>

        <div className="translatedMessage">
            {chat.translatedMessage}
        </div>

    </li>
);

export default Message;


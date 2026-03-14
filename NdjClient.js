const WebSocket = require("ws");
const https = require("https");
const fs = require("fs");
const EventEmitter = require("events");

class NdjClient extends EventEmitter {

constructor(options = {}) {
super();

this.token = options.token;
this.prefix = options.prefix || "!";
this.intents = options.intents || 33281;

this.ws = null;
this.heartbeatInterval = null;

this.s = null;
this.sessionId = null;
this.applicationId = null;

this.gateway = "wss://gateway.discord.gg/?v=10&encoding=json";

this.commands = {
text: new Map(),
slash: new Map()
};

}

/* START */

start(){
this.connect();
}

/* COMMAND REGISTERS */

textCommand(config, run){
this.commands.text.set(config.name,{config,run});
}

slashCommand(config, run){
this.commands.slash.set(config.name,{config,run});
}

/* CONNECT */

connect(){

this.ws = new WebSocket(this.gateway);

this.ws.on("open",()=>{
console.log("[NDJ] Conectado ao Gateway");
});

this.ws.on("message",(data)=>{

const payload = JSON.parse(data.toString());
const { op, d, s, t } = payload;

if(s !== null) this.s = s;

switch(op){

case 10:
this.startHeartbeat(d.heartbeat_interval);
this.identify();
break;

case 11:
break;

case 0:
this.handleEvent(t,d);
break;

case 7:
this.reconnect();
break;

case 9:
setTimeout(()=>this.identify(),2000);
break;

}

});

this.ws.on("close",(code)=>{

console.log("[NDJ] Gateway fechado:",code);

clearInterval(this.heartbeatInterval);

setTimeout(()=>this.connect(),5000);

});

}

/* IDENTIFY */

identify(){

const payload = {
op:2,
d:{
token:this.token,
intents:this.intents,
properties:{
os:"linux",
browser:"ndj-lib",
device:"ndj-lib"
}
}
};

this.ws.send(JSON.stringify(payload));

}

/* HEARTBEAT */

startHeartbeat(interval){

clearInterval(this.heartbeatInterval);

this.heartbeatInterval = setInterval(()=>{

this.ws.send(JSON.stringify({
op:1,
d:this.s
}));

},interval);

}

/* EVENTS */

handleEvent(type,data){

if(!type) return;

/* READY */

if(type === "READY"){

this.sessionId = data.session_id;
this.applicationId = data.application.id;

console.log("[NDJ] Bot online:",data.user.username);

this.registerSlashCommands();

this.emit("ready",data.user);

}

/* MESSAGE */

if(type === "MESSAGE_CREATE"){

if(data.author.bot) return;

const msg = this.createMessageObject(data);

this.handleTextCommands(msg);

this.emit("messageCreate",msg);

}

/* SLASH */

if(type === "INTERACTION_CREATE"){

if(data.type !== 2) return;

const name = data.data.name;
const cmd = this.commands.slash.get(name);

if(!cmd) return;

const options = {};

if(data.data.options){
for(const opt of data.data.options){
options[opt.name] = opt.value;
}
}

const ctx = this.createContext({
options,
channelId:data.channel_id,
guildId:data.guild_id,
user:data.member?.user || data.user,
interactionId:data.id,
interactionToken:data.token,
type:"slash"
});

cmd.run(ctx);

}

}

/* MESSAGE OBJECT */

createMessageObject(data){

return {

id:data.id,
content:data.content,
author:data.author,
channelId:data.channel_id,
guildId:data.guild_id,

reply:(payload)=>this.smartReply(data.channel_id,payload),

react:(emoji)=>this.react(data.channel_id,data.id,emoji),

delete:()=>this.deleteMessage(data.channel_id,data.id),

edit:(content)=>this.editMessage(data.channel_id,data.id,content)

};

}

/* CONTEXT */

createContext(data){

return {

user:data.user,
channelId:data.channelId,
guildId:data.guildId,
options:data.options || {},

reply:(payload)=>{

if(data.type === "slash"){
this.replyInteraction(data.interactionId,data.interactionToken,payload);
}else{
this.smartReply(data.channelId,payload);
}

}

};

}

/* TEXT COMMAND */

handleTextCommands(msg){

if(!msg.content.startsWith(this.prefix)) return;

const args = msg.content.slice(this.prefix.length).split(" ");
const name = args.shift().toLowerCase();

const cmd = this.commands.text.get(name);

if(!cmd) return;

const options = {};

if(cmd.config.options){

cmd.config.options.forEach((opt,i)=>{
options[opt.name] = args[i];
});

}

const ctx = this.createContext({
channelId:msg.channelId,
guildId:msg.guildId,
user:msg.author,
options
});

cmd.run(ctx);

}

/* SMART REPLY */

smartReply(channelId,payload){

if(typeof payload === "string"){
payload = {content:payload};
}

if(payload.embed){
payload.embeds = [payload.embed];
delete payload.embed;
}

this.sendMessage(channelId,payload);

}

/* SEND MESSAGE */

sendMessage(channelId,payload){

const data = JSON.stringify(payload);

const options = {
hostname:"discord.com",
path:`/api/v10/channels/${channelId}/messages`,
method:"POST",
headers:{
"Authorization":`Bot ${this.token}`,
"Content-Type":"application/json",
"Content-Length":Buffer.byteLength(data)
}
};

const req = https.request(options);
req.on("error",console.error);

req.write(data);
req.end();

}

/* FILE */

sendFile(channelId,filePath,content=""){

const file = fs.readFileSync(filePath);
const boundary = "----NDJForm";

const payload = Buffer.from(
`--${boundary}\r
Content-Disposition: form-data; name="payload_json"\r
\r
${JSON.stringify({content})}\r
--${boundary}\r
Content-Disposition: form-data; name="files[0]"; filename="${filePath}"\r
\r
`
);

const end = Buffer.from(`\r\n--${boundary}--`);

const body = Buffer.concat([payload,file,end]);

const options = {

hostname:"discord.com",
path:`/api/v10/channels/${channelId}/messages`,
method:"POST",
headers:{
"Authorization":`Bot ${this.token}`,
"Content-Type":`multipart/form-data; boundary=${boundary}`,
"Content-Length":body.length
}

};

const req = https.request(options);
req.on("error",console.error);

req.write(body);
req.end();

}

/* REACT */

react(channelId,messageId,emoji){

const options = {

hostname:"discord.com",
path:`/api/v10/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`,
method:"PUT",
headers:{
"Authorization":`Bot ${this.token}`
}

};

const req = https.request(options);
req.on("error",console.error);
req.end();

}

/* DELETE */

deleteMessage(channelId,messageId){

const options = {

hostname:"discord.com",
path:`/api/v10/channels/${channelId}/messages/${messageId}`,
method:"DELETE",
headers:{
"Authorization":`Bot ${this.token}`
}

};

const req = https.request(options);
req.on("error",console.error);
req.end();

}

/* EDIT */

editMessage(channelId,messageId,content){

const data = JSON.stringify({content});

const options = {

hostname:"discord.com",
path:`/api/v10/channels/${channelId}/messages/${messageId}`,
method:"PATCH",
headers:{
"Authorization":`Bot ${this.token}`,
"Content-Type":"application/json",
"Content-Length":Buffer.byteLength(data)
}

};

const req = https.request(options);
req.on("error",console.error);

req.write(data);
req.end();

}

/* SLASH REPLY */

replyInteraction(id,token,payload){

if(typeof payload === "string"){
payload = {content:payload};
}

if(payload.embed){
payload.embeds=[payload.embed];
delete payload.embed;
}

const data = JSON.stringify({
type:4,
data:payload
});

const options = {

hostname:"discord.com",
path:`/api/v10/interactions/${id}/${token}/callback`,
method:"POST",
headers:{
"Content-Type":"application/json",
"Content-Length":Buffer.byteLength(data)
}

};

const req = https.request(options);
req.on("error",console.error);

req.write(data);
req.end();

}

/* REGISTER SLASH */

registerSlashCommands(){

const commands = [];

for(const cmd of this.commands.slash.values()){

commands.push({
name:cmd.config.name,
description:cmd.config.description || "NDJ Command",
options:cmd.config.options || []
});

}

const data = JSON.stringify(commands);

const options = {

hostname:"discord.com",
path:`/api/v10/applications/${this.applicationId}/commands`,
method:"PUT",
headers:{
"Authorization":`Bot ${this.token}`,
"Content-Type":"application/json",
"Content-Length":Buffer.byteLength(data)
}

};

const req = https.request(options);
req.on("error",console.error);

req.write(data);
req.end();

}

/* RECONNECT */

reconnect(){

clearInterval(this.heartbeatInterval);

try{
this.ws.close();
}catch{}

setTimeout(()=>this.connect(),3000);

}

}

module.exports = NdjClient;

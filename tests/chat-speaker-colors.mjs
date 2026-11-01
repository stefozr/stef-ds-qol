import assert from "node:assert/strict";
import { pickSpeakerUser, speakerImage, unusableImage } from "../scripts/fixes/chat-speaker-colors.mjs";

// Color owner: assigned character first, then player owners (active first), then the author.
assert.equal(pickSpeakerUser({ characterUserIds: ["p1"], ownerUserIds: ["p2"], authorId: "gm" }), "p1", "assigned character wins");
assert.equal(pickSpeakerUser({ ownerUserIds: ["p2"], authorId: "gm" }), "p2", "Director rolls for a hero: the player's color");
assert.equal(pickSpeakerUser({ ownerUserIds: ["p2", "p3"], activeUserIds: ["gm", "p3"], authorId: "gm" }), "p3", "active owner first");
assert.equal(pickSpeakerUser({ ownerUserIds: ["p2", "p3"], activeUserIds: [], authorId: "gm" }), "p2", "else the first owner");
assert.equal(pickSpeakerUser({ characterUserIds: ["a", "b"], activeUserIds: ["b"] }), "b");
assert.equal(pickSpeakerUser({ authorId: "gm" }), "gm", "NPC: the Director who posted it");
assert.equal(pickSpeakerUser({}), null);

// Unusable images.
const DEF = "icons/svg/mystery-man.svg";
assert.equal(unusableImage(null, DEF), true);
assert.equal(unusableImage(DEF, DEF), true);
assert.equal(unusableImage("tokens/wolf/*.webp", DEF), true, "wildcard");
assert.equal(unusableImage("tokens/fire.webm", DEF), true, "video");
assert.equal(unusableImage("tokens/jaan.webp", DEF), false);

// Portrait chain: token ring art, token texture, prototype, actor portrait.
const ringTok = { ring: { enabled: true, subject: { texture: "ring/jaan.webp" } }, texture: { src: DEF } };
assert.deepEqual(speakerImage({ token: ringTok, actorImg: "a.webp", defaultToken: DEF }), { src: "ring/jaan.webp", ring: true });
const plainTok = { ring: { enabled: false }, texture: { src: "tok/wolf.webp" } };
assert.deepEqual(speakerImage({ token: plainTok, defaultToken: DEF }), { src: "tok/wolf.webp", ring: false });
const blankTok = { ring: { enabled: false }, texture: { src: DEF } };
const proto = { ring: { enabled: true, subject: { texture: "ring/proto.webp" } }, texture: { src: DEF } };
assert.deepEqual(speakerImage({ token: blankTok, prototype: proto, defaultToken: DEF }), { src: "ring/proto.webp", ring: true }, "prototype when the token has nothing");
const wildProto = { ring: { enabled: false }, texture: { src: "tok/goblin-*.webp" } };
assert.deepEqual(speakerImage({ prototype: wildProto, actorImg: "portraits/goblin.webp", defaultToken: DEF }), { src: "portraits/goblin.webp", ring: false }, "wildcard prototype: actor portrait");
assert.equal(speakerImage({ prototype: blankTok, actorImg: DEF, defaultToken: DEF }), null, "nothing usable");
console.log("CHAT SPEAKER COLORS TESTS PASSED");

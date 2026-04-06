declare module "tweetsodium" {
  function seal(message: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array;
  export default { seal };
}

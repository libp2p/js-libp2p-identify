/**
 * Identify is a STUN protocol, used by libp2p-swarmin order to
 * broadcast and learn about the `ip:port` pairs a specific
 * peer is available through and to know when a new stream
 * muxer is established, so a conn can be reused.
 *
 * @module libp2p-identify
 */
'use strict'

exports = module.exports

/**
 * @type {string}
 */
exports.multicodec = '/ipfs/id/1.0.0'

exports.listener = require('./listener')
exports.dialer = require('./dialer')

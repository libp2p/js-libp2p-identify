'use strict'

const PeerId = require('peer-id')
const PeerInfo = require('peer-info')

/**
 * Creates a single `PeerInfo`
 * @returns {Promise<PeerInfo>} a promise resolving a `PeerInfo`
 */
const createPeer = () => {
  return new Promise((resolve, reject) => {
    PeerId.create({ bits: 512 }, (err, id) => {
      if (err) return reject(err)
      resolve(new PeerInfo(id))
    })
  })
}

/**
 * Creates `num` `PeerInfo`'s
 * @param {number} num the number of `PeerInfo` to create
 * @returns {Promise<PeerInfo[]>} a promise resolving array of `PeerInfo`
 */
const createPeers = (num) => {
  return Promise.all([...Array(num)].map(createPeer))
}

module.exports = {
  createPeer,
  createPeers
}

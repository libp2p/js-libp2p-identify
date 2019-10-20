/* eslint-env mocha */
'use strict'

const chai = require('chai')
const dirtyChai = require('dirty-chai')
const expect = chai.expect
chai.use(dirtyChai)
const sinon = require('sinon')
const pull = require('pull-stream')
const pullPair = require('pull-pair/duplex')
const lp = require('pull-length-prefixed')
const pb = require('pull-protocol-buffers')

const multiaddr = require('multiaddr')

const { createPeers } = require('./utils')

const IdentifyService = require('../src')
const Message = require('../src/message')
const {
  MULTICODEC_IDENTIFY,
  MULTICODEC_IDENTIFY_PUSH,
  PROTOCOL_VERSION,
  AGENT_VERSION
} = require('../src/consts')

describe('IdentifyService', () => {
  let identifyService
  let mockSwitch
  let otherPeerInfo

  before(async () => {
    const peers = await createPeers(2)
    mockSwitch = {
      _peerInfo: peers[0],
      dialer: {
        newStream: () => {}
      }
    }
    otherPeerInfo = peers[1]
  })

  afterEach(() => {
    sinon.restore()
  })

  describe('identify', () => {
    it('should handle identify responses', (done) => {
      identifyService = new IdentifyService({
        switch: mockSwitch
      })

      // create both ends of the connection
      const [receiver, dialer] = pullPair()

      // Make the receiver respond
      pull(
        pull.values([
          Message.encode({
            protocolVersion: PROTOCOL_VERSION,
            agentVersion: AGENT_VERSION,
            publicKey: otherPeerInfo.id.pubKey.bytes,
            listenAddrs: [],
            observedAddr: Buffer.alloc(0),
            protocols: []
          })
        ]),
        lp.encode(),
        receiver
      )

      // Run identify
      identifyService.identify(dialer, otherPeerInfo, (err, peerInfo, observedAddr) => {
        expect(err).to.not.exist()
        expect(peerInfo.id.pubKey.bytes).to.eql(otherPeerInfo.id.pubKey.bytes)
        expect(peerInfo.protocols.size).to.eql(0)
        expect(peerInfo.multiaddrs.size).to.eql(0)
        expect(observedAddr).to.eql(null)
        done()
      })
    })

    it('should handle identify responses with addresses, and protocols', (done) => {
      identifyService = new IdentifyService({
        switch: mockSwitch
      })

      // create both ends of the connection
      const [receiver, dialer] = pullPair()

      const listenAddrs = [
        multiaddr('/ip4/127.0.0.1/tcp/9090').buffer,
        multiaddr('/ip4/127.0.0.1/tcp/9091/ws').buffer
      ]
      const observedAddr = multiaddr('/dns4/libp2p.io/tcp/443').buffer
      const protocols = ['/chat/1.0.0']

      // Make the receiver respond
      pull(
        pull.values([
          Message.encode({
            protocolVersion: PROTOCOL_VERSION,
            agentVersion: AGENT_VERSION,
            publicKey: otherPeerInfo.id.pubKey.bytes,
            listenAddrs,
            observedAddr,
            protocols
          })
        ]),
        lp.encode(),
        receiver
      )

      // Run identify
      identifyService.identify(dialer, otherPeerInfo, (err, peerInfo, _observedAddr) => {
        expect(err).to.not.exist()

        const expectedAddrs = peerInfo.multiaddrs.toArray().map(ma => ma.buffer)
        expect(peerInfo.id.pubKey.bytes).to.eql(otherPeerInfo.id.pubKey.bytes)
        expect(Array.from(peerInfo.protocols)).to.eql(protocols)
        expect(expectedAddrs).to.eql(listenAddrs)
        expect(_observedAddr.buffer).to.eql(observedAddr)
        done()
      })
    })

    it('should be able to push identify updates', (done) => {
      identifyService = new IdentifyService({
        switch: mockSwitch
      })

      // create both ends of the connection
      const [receiver, dialer] = pullPair()

      // stub the switch dialer to callback with the dialer stream
      sinon.stub(mockSwitch.dialer, 'newStream').callsArgWith(2, null, dialer)

      // stub the listen addrs
      const listenAddrs = [
        multiaddr('/ip4/127.0.0.1/tcp/5002'),
        multiaddr('/ip4/127.0.0.1/tcp/5003')
      ]
      sinon.stub(mockSwitch._peerInfo.multiaddrs, 'toArray').returns(listenAddrs)

      // stub the protocols
      const protocols = new Set([
        '/echo/1.0.0',
        '/dht/1.0.0'
      ])
      sinon.stub(mockSwitch._peerInfo, 'protocols').value(protocols)

      // The target peer needs to support the push protocol
      const targetPeers = [otherPeerInfo]
      sinon.stub(otherPeerInfo.protocols, 'has').withArgs(MULTICODEC_IDENTIFY_PUSH).returns(true)

      // Pull the values from the push
      pull(
        receiver,
        pb.decode(Message),
        pull.drain((message) => {
          try {
            expect(message).to.eql({
              agentVersion: '',
              protocolVersion: '',
              listenAddrs: listenAddrs.map(addr => addr.buffer),
              protocols: Array.from(protocols),
              observedAddr: null,
              publicKey: null
            })
          } catch (err) {
            done(err)
          }
        }, (err) => {
          expect(err).to.not.exist()
          // End the stream
          pull(
            pull.empty(),
            receiver
          )
        })
      )

      // Run identify
      identifyService.push(targetPeers, done)
    })
  })

  describe('identify handler', () => {
    it('should handle identify protocol requests', (done) => {
      identifyService = new IdentifyService({
        switch: mockSwitch
      })

      // create both ends of the connection
      const [receiver, dialer] = pullPair()

      // Stub getObservedAddrs
      receiver.getObservedAddrs = (cb) => cb(null, [])

      // Collect the response
      pull(
        dialer,
        lp.decode(),
        pull.collect((err, results) => {
          expect(err).to.not.exist()
          expect(results).to.have.length(1)
          expect(Message.decode(results[0])).to.eql({
            protocolVersion: PROTOCOL_VERSION,
            agentVersion: AGENT_VERSION,
            publicKey: mockSwitch._peerInfo.id.pubKey.bytes,
            listenAddrs: [],
            observedAddr: Buffer.alloc(0),
            protocols: []
          })

          done()
        })
      )

      // Run the handler
      identifyService.handleMessage(MULTICODEC_IDENTIFY, receiver)
    })

    it('should collect observed, protocols, and listen addrs', (done) => {
      identifyService = new IdentifyService({
        switch: mockSwitch
      })

      // create both ends of the connection
      const [receiver, dialer] = pullPair()

      // Stub getObservedAddrs
      receiver.getObservedAddrs = (cb) => cb(null, [
        multiaddr('/ip4/127.0.0.1/tcp/5001')
      ])

      // stub the listen addrs
      sinon.stub(mockSwitch._peerInfo.multiaddrs, 'toArray').returns([
        multiaddr('/ip4/127.0.0.1/tcp/5002'),
        multiaddr('/ip4/127.0.0.1/tcp/5003')
      ])

      // stub the protocols
      const protocols = new Set([
        '/echo/1.0.0',
        '/dht/1.0.0'
      ])
      sinon.stub(mockSwitch._peerInfo, 'protocols').value(protocols)

      // Collect the response
      pull(
        dialer,
        lp.decode(),
        pull.collect((err, results) => {
          expect(err).to.not.exist()
          expect(results).to.have.length(1)
          expect(Message.decode(results[0])).to.eql({
            protocolVersion: PROTOCOL_VERSION,
            agentVersion: AGENT_VERSION,
            publicKey: mockSwitch._peerInfo.id.pubKey.bytes,
            listenAddrs: [
              multiaddr('/ip4/127.0.0.1/tcp/5002').buffer,
              multiaddr('/ip4/127.0.0.1/tcp/5003').buffer
            ],
            observedAddr: multiaddr('/ip4/127.0.0.1/tcp/5001').buffer,
            protocols: Array.from(protocols)
          })

          done()
        })
      )

      // Run the handler
      identifyService.handleMessage(MULTICODEC_IDENTIFY, receiver)
    })

    it('should handle identify push requests', (done) => {
      identifyService = new IdentifyService({
        switch: mockSwitch
      })

      // create both ends of the connection
      const [receiver, dialer] = pullPair()
      const addr = multiaddr('/ip4/0.0.0.0/tcp/8080').buffer
      const proto = '/dht/1.0.0'

      // Create mocks on the target peer info so we can validate it was updated
      const mockAddrs = sinon.mock(otherPeerInfo.multiaddrs)
      const mockProtocols = sinon.mock(otherPeerInfo.protocols)
      mockAddrs.expects('clear').once()
      mockAddrs.expects('add').once().withArgs(addr)
      mockProtocols.expects('clear').once()
      mockProtocols.expects('add').once().withArgs(proto)

      // Stub getPeerInfo with the mock peer
      receiver.getPeerInfo = (cb) => cb(null, otherPeerInfo)

      const message = Message.encode({
        listenAddrs: [addr],
        protocols: [proto]
      })

      // Collect the response
      pull(
        pull.values([message]),
        lp.encode(),
        dialer
      )

      // Run the handler
      identifyService.handleMessage(MULTICODEC_IDENTIFY_PUSH, receiver)

      // Let the identify push call stack finish
      setImmediate(() => {
        mockAddrs.verify()
        mockProtocols.verify()
        done()
      })
    })
  })
})

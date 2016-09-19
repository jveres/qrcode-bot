require('babel-polyfill')

/* Globals */

const rp = require('minimal-request-promise')
const botBuilder = require('claudia-bot-builder')
const AWS = require('aws-sdk')

const fbTemplate = botBuilder.fbTemplate
const	dynamoDb = new AWS.DynamoDB.DocumentClient()

const fbGraphApi = 'https://graph.facebook.com/v2.7/'

const dbTable = 'qrcode-bot'

const welcomeTexts = ['hi', 'hello', 'hey', 'hola', 'about']

var request = undefined
var apiRequest = undefined
var user = undefined
var state = undefined

/* Bot states */
const STATE_GET_STARTED      = 'GET_STARTED'
const STATE_SHOW_SAMPLES     = 'SHOW_SAMPLES'
const STATE_ABOUT            = 'ABOUT'
const STATE_HELP             = 'HELP'
const STATE_ENTER_TEXT       = 'ENTER_TEXT'
const STATE_QR_MENU          = 'QR_MENU'
const STATE_START_OVER       = 'START_OVER'
const STATE_BACKGROUND_IMAGE = 'BACKGROUND_IMAGE'
const STATE_QR_CODE          = 'QR_CODE'

const WelcomeAsync = async () => {
  console.log('WelcomeAsync')

  if (state === STATE_GET_STARTED)
    return await GetStartedAsync()
  else {
    if (request.text.toLowerCase() === 'about')
      return await AboutAsync()
    else
      return [
          `Hi ${user.first_name}!`,
      ].concat(await HelpAsync())
  }
}

const GetStartedAsync = async () => {
  console.log('GetStartedAsync')

  user.state = STATE_ENTER_TEXT

  return [
    new fbTemplate.generic()
      .addBubble('Welcome to QRCode Bot 😀', 'This robot helps you to create artistic QR codes!')
        .addImage('https://s3.amazonaws.com/qrcode-bot/images/qrcodebot-logo-small.png')
        .addButton('Show Samples', STATE_SHOW_SAMPLES)
        .addButton('About', STATE_ABOUT)
    .get(),
    `Hello ${user.first_name}!`,
    `Enter content for your QR code.\nThis can be a simple text or a url.`
  ]
}

const ShowSamplesAsync = async () => {
  console.log('ShowSamplesAsync')

  return [
    'Here are few samples made with QRCode Bot:',
    new fbTemplate.image('https://s3.amazonaws.com/qrcode-bot/images/a4136c8a-78e4-46cb-a931-1df0b000bfd4.gif').get(),
    new fbTemplate.image('https://s3.amazonaws.com/qrcode-bot/images/f59d4fe1-3e46-4d33-93b2-642781f9cc5b.gif').get(),
    new fbTemplate.image('https://s3.amazonaws.com/qrcode-bot/images/225365dc-9f99-4cf9-b4d4-141e871a4b83.jpg').get(),
    'Cool, isn\'t it? 😀'
  ].concat(await HelpAsync())
}

const AboutAsync = async () => {
  console.log('AboutAsync')

  return [
    `"QRCode Bot" is an easy to use QR code generator robot.\nWhat it makes unique is the ability to make colorful QR codes even with animated background images.`,
    `Help is context sensitive, just press the hamburger menu icon left to Messenger's input bar at any time.`,
    new fbTemplate.image('https://s3.amazonaws.com/qrcode-bot/images/qrcodebot-messenger-code.png').get(),
  ].concat(await HelpAsync())
}

const HelpAsync = async () => {
  console.log('HelpAsync')

  if (user.state === STATE_ENTER_TEXT)
    return [
      `I'm waiting for your input for the code content.`,
      `This can be a simple text or a url.\nPlease note that you are allowed to use only these characters:\na-Z0-9_·,:;+-*/\~!@#$%^&\`[]()?{}|=<>.`
    ]
  else if (user.state === STATE_BACKGROUND_IMAGE)
    return [
        `I'm waiting for a background image.`,
        `You can send me an image or a url.\nThe following image formats are supported: JPEG, PNG, GIF. You can use animated GIFs too!`,
        `Usually transparent GIFs are the best choice for code readability.\nMessenger's sticker animations may not work, unfortunatelly.`
    ]
  else if (user.state === STATE_QR_MENU)
    return [
      `You are at the QR code menu.`,
      `You can simply enter a text to change the content or send me an image to change the background.`,
      `By pressing 'Make QR' the robot starts creating your code.\nThis can take a while so you can do other stuff while it's working in the background.`,
      `Please note that background processing is time limited, currently for maximum 5 minutes. Oversized images (>10MB) may not work.`
    ]
  else
    return [
      user.state // DEBUG
    ]
}

const StartOverAsync = async () => {
  console.log('StartOverAsync')

  delete user.text
  delete user.image
  
  user.state = STATE_ENTER_TEXT

  return [
    new fbTemplate.button(`Let's start again!`)
      .addButton('Show Samples', STATE_SHOW_SAMPLES)
      .addButton('About', STATE_ABOUT)
    .get(),
    await EnterTextAsync()
  ]
}

const EnterTextAsync = async () => {
  console.log('EnterTextAsync')

  user.state = STATE_ENTER_TEXT

  return 'Please enter the content of your code.'
}

const QRMenuAsync = async () => {
  console.log('QRMenuAsync')

  /* Check user input */
  if (state === STATE_QR_MENU) {
    if (request.text !== '')
      state = STATE_ENTER_TEXT
    else {
      const attachments = request.originalRequest.message.attachments
      if (attachments && attachments.length > 0) {
        const attachment = attachments[0]
        if (attachment.type === 'image')
          state = STATE_BACKGROUND_IMAGE
        else if (attachment.url != '')
          state = STATE_ENTER_TEXT
      }
    }
  }

  console.log('QRMenuAsyncinner state ->', state)

  const IsContentModified = !!user.text
  const IsImageChanged = !!user.image

  const MAX_BUBBLE_TITLE_LENGTH = 80
  const msg = []

  /* Set content */
  if (state === STATE_ENTER_TEXT) {
    if (request.text != '') {
      /* Check for allowed characters */
      const pattern = /^[\w ·,:;+\-*\/\\~!@#$%^&`\[\]()?{}|=<>.]+$/
      if (!pattern.test(request.text))
        return 'Sorry, your input contains invalid characters.\nPlease use only the followings: a-Z 0-9 _ ·,:;+-*/\~!@#$%^&`[]()?{}|=<>.'

      user.text = request.text
    } else {
      const attachments = request.originalRequest.message.attachments
      console.log('attachments ->', attachments)
      if (attachments && attachments.length > 0) {
        const attachment = attachments[0]
        if (attachment.url && attachment.url !== '')
          user.text = attachment.url
        else if (attachment.payload && attachment.payload.url && attachment.payload.url !== '')
          user.text = attachment.payload.url
        else
          return 'Hmm, this doesn\'t seem to be a valid content.'
      }
    }

    if (!IsContentModified) {
      msg.push('Thanks.')
      msg.push('Additionally, you can set a background image too.')
    }
    else
      msg.push('Ok, content changed.')
  }

  /* Set background image */
  if (state === STATE_BACKGROUND_IMAGE) {
    /* Check for image payload */
    delete user.image
    if (request.text === '') {
      const attachments = request.originalRequest.message.attachments
      console.log('attachments ->', attachments)
      if (attachments && attachments.length > 0) {
        const attachment = attachments[0]
        if (attachment.type === 'image')
          user.image = attachment.payload.url
      }
    } else {
      /* Check received url */
      const pattern = /[-a-zA-Z0-9@:%_\+.~#?&//=]{2,256}\.[a-z]{2,63}\b(\/[-a-zA-Z0-9@:%_\+.~#?&//=]*)?/gi
      if (!pattern.test(request.text))
        return 'Hmm, this doesn\'t seem to be a valid url.'
      user.image = request.text
    }
    if (!user.image)
      msg.push('Hmm, this doesn\'t seem to be a valid image.')
    else {
      if (!IsImageChanged)
        msg.push('Background image added.\nNow you are ready to go!')
      else
        msg.push('Ok, image changed.')
    }
  }

  let text = user.text.length > MAX_BUBBLE_TITLE_LENGTH ? user.text.substring(0, MAX_BUBBLE_TITLE_LENGTH-3) + '...' : user.text

  msg.push(
    new fbTemplate.generic()
      .addBubble(text, 'Content')
        .addButton('Change Content', STATE_ENTER_TEXT)
        .addButton((user.image ? 'Change' : 'Set') + ' Image', STATE_BACKGROUND_IMAGE)
        .addButton('⚡️ Make QR', STATE_QR_CODE)
    .get()
  )

  user.state = STATE_QR_MENU

  return msg
}

const BackgroundImageAsync = async () => {
  console.log('BackgroundImageAsync')

  user.state = STATE_BACKGROUND_IMAGE

  return 'Please send me an image or a url.'
}

const QRCodeAsync = async () => {
  console.log('QRCodeAsync')

  let payload = {
    userid: request.sender,
    version: 2,
    text: user.text
  }

  if (user.image) payload.picture = user.image

  const lambda = new AWS.Lambda()
  await lambda.invoke({
		FunctionName: 'qrcode',
		InvocationType: 'Event',
		Payload: JSON.stringify(payload)
  }).promise()

  return undefined
}

async function InitStateAsync() {
  console.log('InitStateAsync')

  /* Default user data */
  user = {
    userid: request.sender,
    first_name: 'Guest',
    locale: 'en_US',
    state: STATE_GET_STARTED
  }

  /* Load user data & state */
  console.log('dynamoDb.get')
  let dbParams = {
  	TableName: dbTable,
  	Key: {
  		userid: request.sender
  	}
  }

  const dbReq = await dynamoDb.get(dbParams).promise()

  if (dbReq.Item)
    user = {...dbReq.Item}
  else {
    try {
      const fbReq = await rp.get(`${fbGraphApi}${request.sender}?fields=first_name,locale&access_token=${apiRequest.env.facebookAccessToken}`)
      const fields = JSON.parse(fbReq.body)
      user.first_name = fields.first_name || 'Guest'
      user.locale = fields.locale || 'en_US'
    } catch(err) {
      console.log('Unable to get user graph')
      console.log(err.stack)
    }
  }

  /* Check state */
  if (request.postback)
    state = request.text
  else
    state = user.state

  console.log('user ->', user)
  console.log('state ->', state)

  /* State changes */

  let msg = undefined

  if (!request.postback && welcomeTexts.indexOf(request.text.toLowerCase()) > -1)
    msg = await WelcomeAsync()

  else if (state === STATE_GET_STARTED)
    msg = await GetStartedAsync()

  else if (state === STATE_SHOW_SAMPLES)
    msg = await ShowSamplesAsync()

  else if (state === STATE_ABOUT)
    msg = await AboutAsync()

  else if (state === STATE_HELP)
    msg = await HelpAsync()

  else if (state === STATE_START_OVER)
    msg = await StartOverAsync()

  else if (state === STATE_ENTER_TEXT && request.postback)
    msg = await EnterTextAsync()

  else if (state === STATE_ENTER_TEXT && !request.postback)
    msg = await QRMenuAsync()

  else if (state === STATE_QR_MENU)
    msg = await QRMenuAsync()

  else if (state === STATE_BACKGROUND_IMAGE && request.postback)
    msg = await BackgroundImageAsync()

  else if (state === STATE_BACKGROUND_IMAGE && !request.postback)
    msg = await QRMenuAsync()

  else if (state === STATE_QR_CODE)
    msg = await QRCodeAsync()

  /* Persist user data & state */
  console.log('dynamoDb.put')
  dbParams = {
    TableName: dbTable,
    Item: {
      userid: request.sender,
      ...user
    }
  }
  await dynamoDb.put(dbParams).promise()

  return msg
}

const api = botBuilder(async (req, apiReq) => {
  try {
    console.log('botBuilder req->', req)
    console.log('botBuilder apiReq->', apiReq)

    /* Init globals */
    request = req
    apiRequest = apiReq

    /* Init state */
    let msg = await InitStateAsync()
    console.log('msg ->', msg)

    /* Respond with message if any */
    if (msg)
      return msg

  } catch(err) {
    console.log(err.stack)
    return [
      'Yay, something went wrong :(',
      'Please try again later!'
    ]
  }
})

module.exports = api

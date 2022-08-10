const fs = require('fs')
const path = require('path')
const Scene = require('telegraf/scenes/base')
const Markup = require('telegraf/markup')
const I18n = require('telegraf-i18n')
const mongoose = require('mongoose')

const { match } = I18n
const i18n = new I18n({
  directory: path.resolve(__dirname, '../locales'),
  defaultLanguage: 'ru',
  defaultLanguageOnMissing: true
})

const localseFile = fs.readdirSync('./locales/')

const escapeHTML = (str) => str.replace(
  /[&<>'"]/g,
  (tag) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag)
)

const catalogPublishNew = new Scene('catalogPublishNew')

catalogPublishNew.enter((ctx) => {
  ctx.replyWithHTML(ctx.i18n.t('scenes.catalog.publish.publish_new'), {
    reply_markup: Markup.keyboard([
      [
        ctx.i18n.t('scenes.btn.cancel')
      ]
    ]).resize()
  })
})

catalogPublishNew.on(['sticker', 'text'], async (ctx) => {
  if (ctx.session.userInfo.moderator !== true) {
    return ctx.replyWithHTML(ctx.i18n.t('scenes.catalog.publish.publish_new_access_denied'))
  }

  let packName

  if (ctx.message.sticker) {
    packName = ctx.message.sticker.set_name
  } else {
    const messageTextMatch = ctx.message.text.match(/addstickers\/(.*)/)

    if(!messageTextMatch) {
      return ctx.scene.reenter()
    }

    packName = messageTextMatch[1]
  }

  if (!packName) {
    return ctx.scene.reenter()
  }

  let stickerSet = await ctx.db.StickerSet.findOne({
    name: packName
  })

  if (!stickerSet) {
    const stickerSetInfo = await ctx.telegram.getStickerSet(packName)

    stickerSet = new ctx.db.StickerSet({
      _id: mongoose.Types.ObjectId(),
      owner: ctx.session.userInfo,
      name: stickerSetInfo.name,
      title: stickerSetInfo.title,
      animated: stickerSetInfo.is_animated,
      video: stickerSetInfo.is_video,
      create: false,
      thirdParty: true
    })
  }

  if (ctx.session.userInfo.moderator === true) {
    stickerSet.about.verified = true
  }

  await stickerSet.save()

  ctx.session.scene.publish = {
    stickerSet: stickerSet._id
  }

  return ctx.scene.enter('catalogPublish')
})

const catalogPublish = new Scene('catalogPublish')

catalogPublish.enter(async (ctx) => {
  if (ctx.session.userInfo.publicBan === true) {
    await ctx.replyWithHTML(ctx.i18n.t('scenes.catalog.publish.bannded'))
    return ctx.scene.leave()
  }

  let stickerSetId

  if (ctx.match && ctx.match[1]) {
    stickerSetId = ctx.match[1]
  } else if (ctx.session.scene.publish) {
    stickerSetId = ctx.session.scene.publish.stickerSet._id
  } else {
    return ctx.scene.leave()
  }

  const stickerSet = await ctx.db.StickerSet.findById(stickerSetId)

  await ctx.replyWithHTML(ctx.i18n.t('scenes.catalog.publish.enter', {
    link: `${ctx.config.stickerLinkPrefix}${stickerSet.name}`,
    title: escapeHTML(stickerSet.title)
  }), {
    reply_markup: Markup.keyboard([
      [
        ctx.i18n.t('scenes.catalog.publish.continue_button')
      ],
      [
        ctx.i18n.t('scenes.btn.cancel')
      ]
    ]).resize()
  })

  ctx.session.scene.publish = {
    stickerSet
  }
})

catalogPublish.hears(match('scenes.catalog.publish.continue_button'), async (ctx) => {
  return ctx.scene.enter('catalogEnterDescription')
})

const catalogEnterDescription = new Scene('catalogEnterDescription')

catalogEnterDescription.enter(async (ctx) => {
  await ctx.replyWithHTML(ctx.i18n.t('scenes.catalog.publish.enter_description'), {
    reply_markup: Markup.keyboard([
      [
        ctx.i18n.t('scenes.btn.cancel')
      ]
    ]).resize()
  })
})

catalogEnterDescription.on('text', async (ctx) => {
  const { entities, text } = ctx.message

  ctx.session.scene.publish.description = text.slice(0, 512)

  if (entities?.length > 0) {
    const hashtags = []
    let currnetHashtag = ''
    let currentEntity = null

    // find hashtags in text via entities
    for (let offset = 0; offset < text.length; offset++) {
      const entity = entities.find(entity => entity.offset === offset)

      if (entity?.type === 'hashtag') {
        currentEntity = entity
      }

      if (currentEntity) {
        if (text[offset] !== '#') {
          currnetHashtag += text[offset]
        }

        if (currentEntity.length === currnetHashtag.length + 1) {
          hashtags.push(currnetHashtag)
          currnetHashtag = ''
          currentEntity = null
        }
      }
    }

    // only unique hashtags
    const uniqueHashtags = [...new Set(hashtags)]

    ctx.session.scene.publish.tags = uniqueHashtags
  }

  return ctx.scene.enter('catalogSelectLanguage')
})

const catalogSelectLanguage = new Scene('catalogSelectLanguage')

catalogSelectLanguage.enter(async (ctx) => {
  if (!ctx.session.scene.publish.languages) {
    ctx.session.scene.publish.languages = []
  }

  const locales = {}

  localseFile.forEach((fileName) => {
    const localName = fileName.split('.')[0]
    if (localName === 'ru' || i18n.t('ru', 'language_name') !== i18n.t(localName, 'language_name')) {
      locales[localName] = {
        flag: i18n.t(localName, 'language_name')
      }
    }
  })

  const button = []

  button.push(Markup.callbackButton(ctx.i18n.t('scenes.catalog.publish.button_all_languages'), 'catalog:set_language:all'))

  Object.keys(locales).map((key) => {
    let name = locales[key].flag

    if (ctx.session.scene.publish.languages.includes(key)) {
      name = `✅ ${name}`
    }

    button.push(Markup.callbackButton(name, `catalog:set_language:${key}`))
  })

  if (ctx.session.scene.publish.languages.length > 0) {
    button.push(Markup.callbackButton(ctx.i18n.t('scenes.catalog.publish.button_confirm_language'), 'catalog:set_language:confirm'))
  }

  const resultText = ctx.i18n.t('scenes.catalog.publish.select_language')

  if (ctx.callbackQuery) {
    await ctx.editMessageText(resultText, {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard(button, {
        columns: 1
      })
    })
  } else {
    await ctx.replyWithHTML(resultText, {
      reply_markup: Markup.inlineKeyboard(button, {
        columns: 1
      })
    })
  }
})

catalogSelectLanguage.action(/^catalog:set_language:(.*)$/, async (ctx) => {
  if (ctx.match[1] === 'all') {
    ctx.session.scene.publish.languages = []
    return ctx.scene.enter('catalogPublishConfirm')
  }

  if (ctx.match[1] === 'confirm') {
    return ctx.scene.enter('catalogPublishConfirm')
  }

  const language = ctx.match[1]

  if (ctx.session.scene.publish.languages.indexOf(language) === -1) {
    ctx.session.scene.publish.languages.push(language)
  } else {
    ctx.session.scene.publish.languages.splice(ctx.session.scene.publish.languages.indexOf(language), 1)
  }

  return ctx.scene.reenter()
})

const catalogSetSafe = new Scene('catalogSetSafe')

catalogSetSafe.enter(async (ctx) => {
  const inlineKeyboard = Markup.inlineKeyboard([
    [
      Markup.callbackButton(ctx.i18n.t('scenes.catalog.publish.button_safe.safe'), 'catalog:set_safe:true')
    ],
    [
      Markup.callbackButton(ctx.i18n.t('scenes.catalog.publish.button_safe.not_safe'), 'catalog:set_safe:false')
    ]
  ])

  const resultText = ctx.i18n.t('scenes.catalog.publish.set_safe')

  await ctx.replyWithHTML(resultText, {
    reply_markup: inlineKeyboard
  })
})

catalogSetSafe.action(/^catalog:set_safe:(.*)$/, async (ctx) => {
  ctx.session.scene.publish.safe = ctx.match[1] === 'true'
  return ctx.scene.enter('catalogPublishConfirm')
})

const catalogPublishConfirm = new Scene('catalogPublishConfirm')

catalogPublishConfirm.enter(async (ctx) => {
  const publish = ctx.session.scene.publish

  const languages = []

  publish.languages.forEach((language) => {
    languages.push(i18n.t(language, 'language_name'))
  })

  if (languages.length === 0) {
    languages.push(ctx.i18n.t('scenes.catalog.publish.button_all_languages'))
  }

  const tags = []

  if (publish.tags && publish.tags.length > 0) {
    publish.tags.forEach((tag) => {
      tags.push(`#${tag}`)
    })
  }

  if (tags.length <= 0) {
    tags.push(ctx.i18n.t('scenes.catalog.publish.no_tags'))
  }

  const resultText = ctx.i18n.t('scenes.catalog.publish.confirm', {
    link: `${ctx.config.stickerLinkPrefix}${publish.stickerSet.name}`,
    title: escapeHTML(publish.stickerSet.title),
    description: escapeHTML(publish.description),
    tags: tags.join(' '),
    languages: languages.join(', '),
    // safe: publish.safe ? ctx.i18n.t('scenes.catalog.publish.button_safe.safe') : ctx.i18n.t('scenes.catalog.publish.button_safe.not_safe')
  })

  await ctx.replyWithHTML(resultText, {
    reply_markup: Markup.keyboard([
      [
        ctx.i18n.t('scenes.catalog.publish.button_confirm')
      ],
      [
        ctx.i18n.t('scenes.btn.cancel')
      ]
    ]).resize()
  })
})

catalogPublishConfirm.hears(match('scenes.catalog.publish.button_confirm'), async (ctx) => {
  const publish = ctx.session.scene.publish

  publish.stickerSet.about = {
    description: publish.description,
    tags: publish.tags,
    languages: publish.languages,
    // safe: publish.safe
  }

  if (!publish.stickerSet.publishDate) {
    publish.stickerSet.publishDate = new Date()
  }

  publish.stickerSet.public = true

  await publish.stickerSet.save()

  await ctx.replyWithHTML(ctx.i18n.t('scenes.catalog.publish.success'))

  ctx.session.scene.publish = null

  ctx.scene.leave()

  await ctx.replyWithHTML('👌', {
    reply_markup: {
      remove_keyboard: true
    }
  })
})

module.exports = [
  catalogPublishNew,
  catalogPublish,
  catalogEnterDescription,
  catalogSelectLanguage,
  catalogSetSafe,
  catalogPublishConfirm
]

#!/usr/bin/env ruby

require "fastlane"
require "spaceship"

APPLE_ID = "maximilian.thuemmler@gmail.com"
APP_IDENTIFIER = "com.thuemmlerai.parkingremindertimer"
FAMILY_NAME = "Parking Reminder Timer Pro"
REVIEW_SCREENSHOT = File.expand_path("../fastlane/iap/review-screenshot.png", __dir__)

PRODUCTS = [
  {
    product_id: "parking_reminder_timer_weekly",
    reference_name: "Parking Reminder Timer Weekly",
    duration: "1w",
    trial: nil,
    tier: 3,
    name: "Parking Reminder Timer Weekly",
    description: "Weekly access to unlimited parking timers, meter alerts, find-car notes, and ticket-free streak sharing."
  },
  {
    product_id: "parking_reminder_timer_annual",
    reference_name: "Parking Reminder Timer Annual",
    duration: "1y",
    trial: "1w",
    tier: 40,
    name: "Parking Reminder Timer Annual",
    description: "Annual access to unlimited parking timers, meter alerts, find-car notes, and ticket-free streak sharing with a 7-day free trial."
  }
].freeze

def localized_product(product)
  {
    "en-US": {
      name: product[:name],
      description: product[:description]
    }
  }
end

def review_notes(product)
  trial = product[:trial] ? " Includes a 7-day introductory free trial." : ""
  "Subscription unlocks unlimited parking reminder sessions, smart pre-expiry alerts, find-car notes, and shareable ticket-free streak cards.#{trial}"
end

Spaceship::Tunes.login(APPLE_ID)
Spaceship::Tunes.select_team
app = Spaceship::Tunes::Application.find(APP_IDENTIFIER)
raise "App not found: #{APP_IDENTIFIER}" unless app

iaps = app.in_app_purchases
existing = iaps.all
family = iaps.families.all.find { |item| item.name == FAMILY_NAME || item.name == "Parking Timer Pro" }

unless family
  first = PRODUCTS.first
  iaps.families.create!(
    name: FAMILY_NAME,
    product_id: first[:product_id],
    reference_name: first[:reference_name],
    versions: {
      "en-US": {
        subscription_name: "Parking Timer Pro",
        name: "Parking Reminder Timer"
      }
    }
  )
  family = iaps.families.all.find { |item| item.name == FAMILY_NAME }
  existing = iaps.all
end

raise "Subscription family could not be created" unless family
family_id = family.family_id

PRODUCTS.each_with_index do |product, index|
  item = existing.find { |candidate| candidate.product_id == product[:product_id] }

  unless item
    iaps.create!(
      type: Spaceship::Tunes::IAPType::RECURRING,
      versions: localized_product(product),
      reference_name: product[:reference_name],
      product_id: product[:product_id],
      cleared_for_sale: true,
      review_notes: review_notes(product),
      review_screenshot: REVIEW_SCREENSHOT,
      pricing_intervals: [{ country: "WW", begin_date: nil, end_date: nil, tier: product[:tier] }],
      family_id: family_id,
      subscription_duration: product[:duration],
      subscription_free_trial: product[:trial]
    )
    existing = iaps.all
    item = existing.find { |candidate| candidate.product_id == product[:product_id] }
  end

  detail = item.edit
  versions = detail.versions
  versions[:"en-US"] ||= {}
  versions[:"en-US"][:name] = product[:name]
  versions[:"en-US"][:description] = product[:description]
  detail.versions = versions
  detail.subscription_duration = product[:duration]
  detail.subscription_free_trial = product[:trial] if product[:trial]
  detail.cleared_for_sale = true
  detail.review_notes = review_notes(product)
  detail.review_screenshot = REVIEW_SCREENSHOT
  detail.pricing_intervals = [{ country: "WW", begin_date: nil, end_date: nil, tier: product[:tier] }]
  detail.save!

  puts "#{index + 1}. #{product[:product_id]} ready in family #{family_id}"
end

puts "subscription_group=#{family_id}"

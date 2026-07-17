import { chromium } from 'playwright'
const out = 'C:/Users/Jonayed/AppData/Local/Temp/claude/d--Cannonball/9f236910-9eeb-4176-9b31-e40e48b8ef7d/scratchpad'
const URL = 'http://localhost:5199/?server=ws://localhost:2599'
async function main() {
  const b = await chromium.launch({ args: ['--use-gl=angle'] })
  const c1 = await b.newContext({ viewport: { width: 1100, height: 750 } })
  const host = await c1.newPage()
  await host.goto(URL, { waitUntil: 'domcontentloaded' })
  await host.waitForSelector('text=CANNONBALL', { timeout: 15000 })
  await host.waitForTimeout(1000)
  await host.locator('input[placeholder="your name"]').fill('Alice')
  await host.locator('input[placeholder="your name"]').press('Enter')

  const c2 = await b.newContext({ viewport: { width: 1100, height: 750 } })
  const friend = await c2.newPage()
  await friend.goto(URL, { waitUntil: 'domcontentloaded' })
  await friend.waitForSelector('text=CANNONBALL', { timeout: 15000 })
  await friend.waitForTimeout(1000)
  await friend.locator('input[placeholder="your name"]').fill('Bob')
  await friend.locator('input[placeholder="your name"]').press('Enter')
  await friend.waitForTimeout(1000)

  await host.keyboard.press('Backquote')
  await host.locator('button', { hasText: 'skip phase' }).click()
  await host.waitForTimeout(600)
  await host.locator('button', { hasText: 'skip phase' }).click()
  await host.waitForTimeout(600)
  await host.locator('button', { hasText: 'skip phase' }).click()
  await host.waitForTimeout(2500)
  // eliminate Alice -> orbit spectator cam sees the whole pitch + all tags
  await host.locator('button', { hasText: 'eliminate me' }).click()
  await host.waitForTimeout(3500)
  await host.keyboard.press('Backquote')
  await host.waitForTimeout(600)
  await host.screenshot({ path: `${out}/tags-orbit.png` })
  console.log('orbit shot taken')
  await b.close()
}
void main()

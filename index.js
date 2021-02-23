const puppeteer = require('puppeteer')
const fs = require('fs').promises
const Jimp = require('jimp')
const pixelmatch = require('pixelmatch')
const { cv } = require('opencv-wasm')

async function findPuzzlePosition (page) {
    let images = await page.$$eval('.geetest_canvas_img canvas', canvases => canvases.map(canvas => canvas.toDataURL().replace(/^data:image\/png;base64,/, '')))

    await fs.writeFile(`./puzzle.png`, images[1], 'base64')

    let srcPuzzleImage = await Jimp.read('./puzzle.png')
    let srcPuzzle = cv.matFromImageData(srcPuzzleImage.bitmap)
    let dstPuzzle = new cv.Mat()

    cv.cvtColor(srcPuzzle, srcPuzzle, cv.COLOR_BGR2GRAY)
    cv.threshold(srcPuzzle, dstPuzzle, 127, 255, cv.THRESH_BINARY)

    let kernel = cv.Mat.ones(5, 5, cv.CV_8UC1)
    let anchor = new cv.Point(-1, -1)
    cv.dilate(dstPuzzle, dstPuzzle, kernel, anchor, 1)
    cv.erode(dstPuzzle, dstPuzzle, kernel, anchor, 1)

    let contours = new cv.MatVector()
    let hierarchy = new cv.Mat()
    cv.findContours(dstPuzzle, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

    let contour = contours.get(0)
    let moment = cv.moments(contour)

    return [Math.floor(moment.m10 / moment.m00), Math.floor(moment.m01 / moment.m00)]
}

async function findDiffPosition (page) {
    await page.waitForTimeout(100)

    let srcImage = await Jimp.read('./diff.png')
    let src = cv.matFromImageData(srcImage.bitmap)

    let dst = new cv.Mat()
    let kernel = cv.Mat.ones(5, 5, cv.CV_8UC1)
    let anchor = new cv.Point(-1, -1)

    cv.threshold(src, dst, 127, 255, cv.THRESH_BINARY)
    cv.erode(dst, dst, kernel, anchor, 1)
    cv.dilate(dst, dst, kernel, anchor, 1)
    cv.erode(dst, dst, kernel, anchor, 1)
    cv.dilate(dst, dst, kernel, anchor, 1)

    cv.cvtColor(dst, dst, cv.COLOR_BGR2GRAY)
    cv.threshold(dst, dst, 150, 255, cv.THRESH_BINARY_INV)

    let contours = new cv.MatVector()
    let hierarchy = new cv.Mat()
    cv.findContours(dst, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

    let contour = contours.get(0)
    let moment = cv.moments(contour)

    return [Math.floor(moment.m10 / moment.m00), Math.floor(moment.m01 / moment.m00)]
}

async function saveSliderCaptchaImages(page) {
    await page.waitForSelector('div.geetest_radar_tip')
    await page.waitForTimeout(1000)

    await page.click('div.geetest_radar_tip')

    await page.waitForSelector('.geetest_canvas_img canvas', { visible: true })
    await page.waitForTimeout(1000)
    let images = await page.$$eval('.geetest_canvas_img canvas', canvases => {
        return canvases.map(canvas => canvas.toDataURL().replace(/^data:image\/png;base64,/, ''))
    })

    await fs.writeFile(`./captcha.png`, images[0], 'base64')
    await fs.writeFile(`./original.png`, images[2], 'base64')
}

async function saveDiffImage() {
    const originalImage = await Jimp.read('./original.png')
    const captchaImage = await Jimp.read('./captcha.png')

    const { width, height } = originalImage.bitmap
    const diffImage = new Jimp(width, height)

    const diffOptions = { includeAA: true, threshold: 0.2 }

    pixelmatch(originalImage.bitmap.data, captchaImage.bitmap.data, diffImage.bitmap.data, width, height, diffOptions)
    diffImage.write('./diff.png')
}

const captcha = 2; 
const cSite = "https://geo.captcha-delivery.com/captcha/?initialCid=AHrlqAAAAAMALAg_XYh3MEgAQkFc-g==&hash=A55FBF4311ED6F1BF9911EB71931D5&cid=4jfhmnt55DPL5o00bLj.4OXQdSu9_pFCszua0PRcPgdqxxf9PNJ3.Ev~~xz8pqJhdpxt.QJiOodYzCwiuotRylfDSV44IYEzWFkvq3aLeD&t=fe&s=17434";

async function run () {
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: { width: 500, height: 750 }
    })
    const page = await browser.newPage()
    async function a1 () {
    await page.goto('https://pwote.co/captchasolver')
    //for the sake of clarity, i just made a simple >0 eq. 
    if (captcha > 0) { 
    await page.goto(cSite, { waitUntil: 'networkidle2' })

    await page.waitForTimeout(1000)

    await saveSliderCaptchaImages(page)
    await saveDiffImage()

    let [cx, cy] = await findDiffPosition(page)

    const sliderHandle = await page.$('.geetest_slider_button')
    const handle = await sliderHandle.boundingBox()

    let xPosition = handle.x + handle.width / 2
    let yPosition = handle.y + handle.height / 2
    await page.mouse.move(xPosition, yPosition)
    await page.mouse.down()

    xPosition = handle.x + cx - handle.width / 2
    yPosition = handle.y + handle.height / 3
    await page.mouse.move(xPosition, yPosition, { steps: 25 })

    await page.waitForTimeout(100)

    let [cxPuzzle, cyPuzzle] = await findPuzzlePosition(page)

    xPosition = xPosition + cx - cxPuzzle
    yPosition = handle.y + handle.height / 2
    await page.mouse.move(xPosition, yPosition, { steps: 5 })
    await page.mouse.up()

    await page.waitForTimeout(3000)
    // success!
    
    await fs.unlink('./original.png')
    await fs.unlink('./captcha.png')
    await fs.unlink('./diff.png')
    await fs.unlink('./puzzle.png')

    // this is the part where you would put shit that would remove the captcha solved from queue
    // im really not sure how to do that frontend wise without fucking up the multi-solver support part
    // but have fun figuring that out
    //
    // i guess you can just do math and have captcha -1, but then again, that would fuck up if you have two solvers solve at once
    // and a catch for errors should be needed in case the link is nullified
    // but i handle that on backend so uh good luck

    await page.reload();
    await a1();

}
}
a1()
}
run()

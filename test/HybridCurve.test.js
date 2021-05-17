const { expect } = require("chai");
const { ethers } = require("hardhat");
const { BigNumber, utils } = require("ethers");

function randDecimals() {
    return Math.floor(Math.random() * 19); // [0, 18]
}

function randA() {
    return Math.floor(Math.random() * 500000) + 100; // [100, 500099]
}

function buildRandData() {
    let decimals0 = randDecimals();
    let decimals1 = randDecimals();
    let A = randA();
    return buildData(decimals0, decimals1, A);
}

function decodeData(data) {
    let d0 = BigNumber.from(utils.hexDataSlice(data, 0, 1)).toNumber();
    let d1 = BigNumber.from(utils.hexDataSlice(data, 1, 2)).toNumber();
    let a = BigNumber.from(utils.hexDataSlice(data, 2));
    return [d0, d1, a];
}

function buildData(decimals0, decimals1, A) {
    let d0 = BigNumber.from(decimals0).toHexString();
    d0 = utils.hexZeroPad(d0, 32);
    d0 = utils.hexDataSlice(d0, 31); // uint8 size

    let d1 = BigNumber.from(decimals1).toHexString();
    d1 = utils.hexZeroPad(d1, 32);
    d1 = utils.hexDataSlice(d1, 31); // uint8 size

    let a = BigNumber.from(A).toHexString();
    a = utils.hexZeroPad(a, 32);
    a = utils.hexDataSlice(a, 2); // uint240 size

    return utils.hexConcat([d0, d1, a]);
}

describe("HybridCurve.sol test", function () {
    let HC, test;
    let n, js, con, data;
    const BASE = BigNumber.from(10).pow(18);

    before(async function () {
        HC = await ethers.getContractFactory("HybridCurve");
        test = await HC.deploy();
    });

    describe("#decodeData()", () => {
        it("Reverts when data is not valid", async function () {
            data = buildData(19, 1, 50000);
            await expect(test.decodeData(data)).to.be.revertedWith("MIRIN: INVALID_DATA");

            data = buildData(18, 19, 50000);
            await expect(test.decodeData(data)).to.be.revertedWith("MIRIN: INVALID_DATA");

            data = buildData(18, 18, 99);
            await expect(test.decodeData(data)).to.be.revertedWith("MIRIN: INVALID_DATA");
        });

        it("Succeeds when data is valid", async function () {
            for (let n = 0; n < 1000; n++) {
                let data = buildRandData();
                let expected = decodeData(data);
                let result = await test.decodeData(data);
                expect(result).to.deep.eq(expected);
            }
        });
    });

    describe("#computeAmountOut()", () => {
        it("Succeeds with 18 decimal tokens", async function () {
            // Swap 1e17 of 18 decimal token for 18 decimal token at varying A values
            expect(
                await test.computeAmountOut(String(1e17), String(1e18), String(1e18), buildData(18, 18, 100), 3, 0)
            ).to.eq("94941617877778399");

            expect(
                await test.computeAmountOut(String(1e17), String(1e18), String(1e18), buildData(18, 18, 5000), 3, 0)
            ).to.eq("99503006734612204");

            expect(
                await test.computeAmountOut(String(1e17), String(1e18), String(1e18), buildData(18, 18, 500000), 3, 0)
            ).to.eq("99697986310591444");
        });

        it("Succeeds with tokens of different decimals", async function () {
            // Swap 1e17 of 18 decimal token for 6 decimal token at varying A values
            expect(
                await test.computeAmountOut(String(1e17), String(1e18), String(1e6), buildData(18, 6, 100), 3, 0)
            ).to.eq("94941");

            expect(
                await test.computeAmountOut(String(1e17), String(1e18), String(1e6), buildData(18, 6, 5000), 3, 0)
            ).to.eq("99503");

            expect(
                await test.computeAmountOut(String(1e17), String(1e18), String(1e6), buildData(18, 6, 500000), 3, 0)
            ).to.eq("99697");

            // Swap 1e5 of 6 decimal token for 18 decimal token at varying A values
            expect(
                await test.computeAmountOut(String(1e5), String(1e18), String(1e6), buildData(18, 6, 100), 3, 1)
            ).to.eq("94941617877778399");

            expect(
                await test.computeAmountOut(String(1e5), String(1e18), String(1e6), buildData(18, 6, 5000), 3, 1)
            ).to.eq("99503006734612204");

            expect(
                await test.computeAmountOut(String(1e5), String(1e18), String(1e6), buildData(18, 6, 500000), 3, 1)
            ).to.eq("99697986310591444");
        });
    });
});

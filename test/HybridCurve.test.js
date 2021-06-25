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
        describe("Pair of same decimals (18 decimals + 18 decimals pair)", () => {
            it("Succeeds even when using high balance", async function () {
                expect(
                    await test.computeAmountOut(
                        BigNumber.from(10).pow(25),
                        BigNumber.from(10).pow(33),
                        BigNumber.from(10).pow(33),
                        buildData(18, 18, 100),
                        3,
                        0
                    )
                ).to.be.eq("9969999950150000249249997");
            });

            it("Succeeds to calculate amount out", async function () {
                // Swap 1e17 of 18 decimal token for 18 decimal token at varying A values
                expect(
                    await test.computeAmountOut(String(1e17), String(1e18), String(1e18), buildData(18, 18, 100), 3, 0)
                ).to.eq("94941617877778399");

                expect(
                    await test.computeAmountOut(String(1e17), String(1e18), String(1e18), buildData(18, 18, 5000), 3, 0)
                ).to.eq("99503006734612204");

                expect(
                    await test.computeAmountOut(
                        String(1e17),
                        String(1e18),
                        String(1e18),
                        buildData(18, 18, 500000),
                        3,
                        0
                    )
                ).to.eq("99697986310591444");
            });

            it("Succeeds with imbalanced pool setup (sparse -> abundant)", async function () {
                // Swap 1e17 of sparse 18 decimal token for abundant 18 decimal token at varying A values
                // At low A value we expect the trade to happen similar to a regular sushi swap pair
                // As A is increased, the imbalance of the pool becomes less weighted.
                // At high A, we expect the trade to happen as if the pool is balanced.
                expect(
                    await test.computeAmountOut(
                        String(1e17),
                        String(80e18),
                        String(120e18),
                        buildData(18, 18, 100),
                        3,
                        0
                    )
                ).to.eq("122411604069641073");

                expect(
                    await test.computeAmountOut(
                        String(1e17),
                        String(80e18),
                        String(120e18),
                        buildData(18, 18, 5000),
                        3,
                        0
                    )
                ).to.eq("100547177117692933");

                expect(
                    await test.computeAmountOut(
                        String(1e17),
                        String(80e18),
                        String(120e18),
                        buildData(18, 18, 500000),
                        3,
                        0
                    )
                ).to.eq("99708627684742534");
            });

            it("Succeeds with imbalanced pool setup (abundant -> sparse)", async function () {
                // Swap 1e17 of abundant 18 decimal token for sparse 18 decimal token at varying A values
                expect(
                    await test.computeAmountOut(
                        String(1e17),
                        String(80e18),
                        String(120e18),
                        buildData(18, 18, 100),
                        3,
                        1
                    )
                ).to.eq("81114740843624621");

                expect(
                    await test.computeAmountOut(
                        String(1e17),
                        String(80e18),
                        String(120e18),
                        buildData(18, 18, 5000),
                        3,
                        1
                    )
                ).to.eq("98855096633898709");

                expect(
                    await test.computeAmountOut(
                        String(1e17),
                        String(80e18),
                        String(120e18),
                        buildData(18, 18, 500000),
                        3,
                        1
                    )
                ).to.eq("99691322596171150");
            });
        });

        describe("Pair of different decimals (18 decimals + 6 decimals pair)", () => {
            it("Succeeds to calculate amount out", async function () {
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

            it("Succeeds with imbalanced pool setup (sparse -> abundant)", async function () {
                // Swap 1e17 of sparse 18 decimal token for abundant 6 decimal token at varying A values
                expect(
                    await test.computeAmountOut(String(1e17), String(80e18), String(120e6), buildData(18, 6, 100), 3, 0)
                ).to.eq("122411");

                expect(
                    await test.computeAmountOut(
                        String(1e17),
                        String(80e18),
                        String(120e6),
                        buildData(18, 6, 5000),
                        3,
                        0
                    )
                ).to.eq("100547");

                expect(
                    await test.computeAmountOut(
                        String(1e17),
                        String(80e18),
                        String(120e6),
                        buildData(18, 6, 500000),
                        3,
                        0
                    )
                ).to.eq("99708");
            });

            it("Succeeds with imbalanced pool setup (abundant -> sparse)", async function () {
                // Swap 1e17 of abundant 6 decimal token for sparse 18 decimal token at varying A values
                expect(
                    await test.computeAmountOut(String(1e5), String(80e18), String(120e6), buildData(18, 6, 100), 3, 1)
                ).to.eq("81114740843624621");

                expect(
                    await test.computeAmountOut(String(1e5), String(80e18), String(120e6), buildData(18, 6, 5000), 3, 1)
                ).to.eq("98855096633898709");

                expect(
                    await test.computeAmountOut(
                        String(1e5),
                        String(80e18),
                        String(120e6),
                        buildData(18, 6, 500000),
                        3,
                        1
                    )
                ).to.eq("99691322596171150");
            });
        });
    });

    describe("#computeAmountIn()", () => {
        describe("Pair of same decimals (18 decimals + 18 decimals pair)", () => {
            it("Succeeds to calculate amount in", async () => {
                // Compute how much input is required at varying A values
                expect(
                    await test.computeAmountIn(
                        "94941617877778399",
                        String(1e18),
                        String(1e18),
                        buildData(18, 18, 100),
                        3,
                        0
                    )
                ).to.eq("99999999999999999");

                expect(
                    await test.computeAmountIn(
                        "99503006734612204",
                        String(1e18),
                        String(1e18),
                        buildData(18, 18, 5000),
                        3,
                        0
                    )
                ).to.eq("99999999999999999");

                expect(
                    await test.computeAmountIn(
                        "99697986310591444",
                        String(1e18),
                        String(1e18),
                        buildData(18, 18, 500000),
                        3,
                        0
                    )
                ).to.eq("99999999999999999");
            });

            it("Succeeds with imbalanced pool setup (sparse -> abundant)", async function () {
                expect(
                    await test.computeAmountIn(
                        "122411604069641073",
                        String(80e18),
                        String(120e18),
                        buildData(18, 18, 100),
                        3,
                        0
                    )
                ).to.eq("99999999999999999");

                expect(
                    await test.computeAmountIn(
                        "100547177117692933",
                        String(80e18),
                        String(120e18),
                        buildData(18, 18, 5000),
                        3,
                        0
                    )
                ).to.eq("99999999999999999");

                expect(
                    await test.computeAmountIn(
                        "99708627684742534",
                        String(80e18),
                        String(120e18),
                        buildData(18, 18, 500000),
                        3,
                        0
                    )
                ).to.eq("99999999999999999");
            });

            it("Succeeds with imbalanced pool setup (abundant -> sparse)", async function () {
                expect(
                    await test.computeAmountIn(
                        "81114740843624621",
                        String(80e18),
                        String(120e18),
                        buildData(18, 18, 100),
                        3,
                        1
                    )
                ).to.eq("99999999999999999");

                expect(
                    await test.computeAmountIn(
                        "98855096633898709",
                        String(80e18),
                        String(120e18),
                        buildData(18, 18, 5000),
                        3,
                        1
                    )
                ).to.eq("99999999999999999");

                expect(
                    await test.computeAmountIn(
                        "99691322596171150",
                        String(80e18),
                        String(120e18),
                        buildData(18, 18, 500000),
                        3,
                        1
                    )
                ).to.eq("99999999999999999");
            });
        });

        describe("Pair of different decimals (18 decimals + 6 decimals pair)", function () {
            it("Succeeds with tokens of different decimals", async function () {
                // Compute amount in required to get 6 decimal tokens at varying A values
                expect(
                    await test.computeAmountIn("94941", String(1e18), String(1e6), buildData(18, 6, 100), 3, 0)
                ).to.eq("99999316426437242");

                expect(
                    await test.computeAmountIn("99503", String(1e18), String(1e6), buildData(18, 6, 5000), 3, 0)
                ).to.eq("99999993218090731");

                expect(
                    await test.computeAmountIn("99697", String(1e18), String(1e6), buildData(18, 6, 500000), 3, 0)
                ).to.eq("99999010681206893");

                // Compute amount in required to get 18 decimal tokens at varying A values
                expect(
                    await test.computeAmountIn(
                        "94941617877778399",
                        String(1e18),
                        String(1e6),
                        buildData(18, 6, 100),
                        3,
                        1
                    )
                ).to.eq("99999");

                expect(
                    await test.computeAmountIn(
                        "99503006734612204",
                        String(1e18),
                        String(1e6),
                        buildData(18, 6, 5000),
                        3,
                        1
                    )
                ).to.eq("99999");

                expect(
                    await test.computeAmountIn(
                        "99697986310591444",
                        String(1e18),
                        String(1e6),
                        buildData(18, 6, 500000),
                        3,
                        1
                    )
                ).to.eq("99999");
            });

            it("Succeeds with imbalanced pool setup (sparse -> abundant)", async function () {
                expect(
                    await test.computeAmountIn(String(1e5), String(80e18), String(120e6), buildData(18, 6, 100), 3, 0)
                ).to.eq("81682719428770142");

                expect(
                    await test.computeAmountIn(String(1e5), String(80e18), String(120e6), buildData(18, 6, 5000), 3, 0)
                ).to.eq("99455787264111639");

                expect(
                    await test.computeAmountIn(
                        String(1e5),
                        String(80e18),
                        String(120e6),
                        buildData(18, 6, 500000),
                        3,
                        0
                    )
                ).to.eq("100292223848503994");
            });

            it("Succeeds with imbalanced pool setup (abundant -> sparse)", async function () {
                expect(
                    await test.computeAmountIn(
                        "81114740843624621",
                        String(80e18),
                        String(120e6),
                        buildData(18, 6, 100),
                        3,
                        1
                    )
                ).to.eq("99999");

                expect(
                    await test.computeAmountIn(
                        "98855096633898709",
                        String(80e18),
                        String(120e6),
                        buildData(18, 6, 5000),
                        3,
                        1
                    )
                ).to.eq("99999");

                expect(
                    await test.computeAmountIn(
                        "99691322596171150",
                        String(80e18),
                        String(120e6),
                        buildData(18, 6, 500000),
                        3,
                        1
                    )
                ).to.eq("99999");
            });
        });
    });

    describe("#computeLiquidity()", () => {
        it("Successfully calculates D at balanced ratio", async () => {
            // Compute how much total liquidity is available
            expect(await test.computeLiquidity(String(1e18), String(1e18), buildData(18, 18, 100))).to.eq(String(2e18));

            expect(await test.computeLiquidity(String(1e18), String(1e18), buildData(18, 18, 1000))).to.eq(
                String(2e18)
            );

            expect(await test.computeLiquidity(String(1e18), String(1e18), buildData(18, 18, 10000))).to.eq(
                String(2e18)
            );
        });

        it("Successfully calculates D at imbalanced ratio", async () => {
            // Compute how much total liquidity is available
            expect(await test.computeLiquidity(String(1e18), String(2e18), buildData(18, 18, 100))).to.eq(
                "2912328492271816922"
            );

            expect(await test.computeLiquidity(String(1e18), String(2e18), buildData(18, 18, 1000))).to.eq(
                "2983226103055844164"
            );

            expect(await test.computeLiquidity(String(1e18), String(2e18), buildData(18, 18, 10000))).to.eq(
                "2998146985239894576"
            );
        });

        it("Computed liquidity increases after each swap even at 0.1% fee setting @ A = 1", async () => {
            // Compute how much total liquidity is available
            let reserve0 = BigNumber.from(10).pow(18);
            let reserve1 = BigNumber.from(10).pow(18);
            let data = buildData(18, 18, 100);
            const SWAP_FEE = 1;

            let computedLiquidity = await test.computeLiquidity(reserve0, reserve1, data);
            expect(computedLiquidity).to.eq(String(2e18));

            // Simulate a swap back and forth 100 times
            for (let i = 0; i < 100; i++) {
                let prevComputedLiquidity = computedLiquidity;

                // Alternate tokenIn
                let tokenIn = i % 2;

                // Calculate amount out
                let amountIn = BigNumber.from(10).pow(17);
                let amountOut = await test.computeAmountOut(amountIn, reserve0, reserve1, data, SWAP_FEE, tokenIn);

                // Update reserves based on tokenIn
                if (tokenIn === 0) {
                    reserve0 = reserve0.add(amountIn);
                    reserve1 = reserve1.sub(amountOut);
                } else {
                    reserve1 = reserve1.add(amountIn);
                    reserve0 = reserve0.sub(amountOut);
                }

                // Re-calculate available liquidity
                computedLiquidity = await test.computeLiquidity(reserve0, reserve1, data);

                // Check the available liquidity increased
                expect(computedLiquidity).to.be.gt(prevComputedLiquidity);
            }
        });

        it("Computed liquidity increases after each swap even at 0.1% fee setting @ A = 10", async () => {
            // Compute how much total liquidity is available
            let reserve0 = BigNumber.from(10).pow(18);
            let reserve1 = BigNumber.from(10).pow(18);
            let data = buildData(18, 18, 1000);
            const SWAP_FEE = 1;

            let computedLiquidity = await test.computeLiquidity(reserve0, reserve1, data);
            expect(computedLiquidity).to.eq(String(2e18));

            // Simulate a swap back and forth 100 times
            for (let i = 0; i < 100; i++) {
                let prevComputedLiquidity = computedLiquidity;

                // Alternate tokenIn
                let tokenIn = i % 2;

                // Calculate amount out
                let amountIn = BigNumber.from(10).pow(17);
                let amountOut = await test.computeAmountOut(amountIn, reserve0, reserve1, data, SWAP_FEE, tokenIn);

                // Update reserves based on tokenIn
                if (tokenIn === 0) {
                    reserve0 = reserve0.add(amountIn);
                    reserve1 = reserve1.sub(amountOut);
                } else {
                    reserve1 = reserve1.add(amountIn);
                    reserve0 = reserve0.sub(amountOut);
                }

                // Re-calculate available liquidity
                computedLiquidity = await test.computeLiquidity(reserve0, reserve1, data);

                // Check the available liquidity increased
                expect(computedLiquidity).to.be.gt(prevComputedLiquidity);
            }
        });

        it("Computed liquidity increases after each swap even at 0.1% fee setting @ A = 100", async () => {
            // Compute how much total liquidity is available
            let reserve0 = BigNumber.from(10).pow(18);
            let reserve1 = BigNumber.from(10).pow(18);
            let data = buildData(18, 18, 10000);
            const SWAP_FEE = 1;

            let computedLiquidity = await test.computeLiquidity(reserve0, reserve1, data);
            expect(computedLiquidity).to.eq(String(2e18));

            // Simulate a swap back and forth 100 times
            for (let i = 0; i < 100; i++) {
                let prevComputedLiquidity = computedLiquidity;

                // Alternate tokenIn
                let tokenIn = i % 2;

                // Calculate amount out
                let amountIn = BigNumber.from(10).pow(17);
                let amountOut = await test.computeAmountOut(amountIn, reserve0, reserve1, data, SWAP_FEE, tokenIn);

                // Update reserves based on tokenIn
                if (tokenIn === 0) {
                    reserve0 = reserve0.add(amountIn);
                    reserve1 = reserve1.sub(amountOut);
                } else {
                    reserve1 = reserve1.add(amountIn);
                    reserve0 = reserve0.sub(amountOut);
                }

                // Re-calculate available liquidity
                computedLiquidity = await test.computeLiquidity(reserve0, reserve1, data);

                // Check the available liquidity increased
                expect(computedLiquidity).to.be.gt(prevComputedLiquidity);
            }
        });

        it("Computed liquidity increases after each swap even at 0.1% fee setting @ A = 100, different decimals", async () => {
            // Compute how much total liquidity is available
            const decimal0 = 18;
            const decimal1 = 6;
            let reserve0 = BigNumber.from(10).pow(18);
            let reserve1 = BigNumber.from(10).pow(6);
            let data = buildData(18, 6, 10000);
            const SWAP_FEE = 1;

            let computedLiquidity = await test.computeLiquidity(reserve0, reserve1, data);
            expect(computedLiquidity).to.eq(String(2e18));

            // Simulate a swap back and forth 100 times
            for (let i = 0; i < 100; i++) {
                let prevComputedLiquidity = computedLiquidity;

                // Alternate tokenIn
                let tokenIn = i % 2;

                // Calculate amount out
                let amountIn = BigNumber.from(10).pow((tokenIn === 0 ? decimal0 : decimal1) - 1);
                let amountOut = await test.computeAmountOut(amountIn, reserve0, reserve1, data, SWAP_FEE, tokenIn);

                // Update reserves based on tokenIn
                if (tokenIn === 0) {
                    reserve0 = reserve0.add(amountIn);
                    reserve1 = reserve1.sub(amountOut);
                } else {
                    reserve1 = reserve1.add(amountIn);
                    reserve0 = reserve0.sub(amountOut);
                }

                // Re-calculate available liquidity
                computedLiquidity = await test.computeLiquidity(reserve0, reserve1, data);

                // Check the available liquidity increased
                expect(computedLiquidity).to.be.gt(prevComputedLiquidity);
            }
        });

        it("Computed liquidity increases after each swap even at 0.1% fee setting @ A = 100, different decimals, large reserves", async () => {
            // Compute how much total liquidity is available
            const decimal0 = 18;
            const decimal1 = 6;
            let reserve0 = BigNumber.from(10).pow(18).mul(10000000);
            let reserve1 = BigNumber.from(10).pow(6).mul(10000000);
            let data = buildData(18, 6, 10000);
            const SWAP_FEE = 1;

            let computedLiquidity = await test.computeLiquidity(reserve0, reserve1, data);
            expect(computedLiquidity).to.eq(BigNumber.from(10).pow(18).mul(20000000));

            // Simulate a swap back and forth 100 times
            for (let i = 0; i < 100; i++) {
                let prevComputedLiquidity = computedLiquidity;

                // Alternate tokenIn
                let tokenIn = i % 2;

                // Calculate amount out
                let amountIn = BigNumber.from(10).pow((tokenIn === 0 ? decimal0 : decimal1) + 5);
                let amountOut = await test.computeAmountOut(amountIn, reserve0, reserve1, data, SWAP_FEE, tokenIn);

                // Update reserves based on tokenIn
                if (tokenIn === 0) {
                    reserve0 = reserve0.add(amountIn);
                    reserve1 = reserve1.sub(amountOut);
                } else {
                    reserve1 = reserve1.add(amountIn);
                    reserve0 = reserve0.sub(amountOut);
                }

                // Re-calculate available liquidity
                computedLiquidity = await test.computeLiquidity(reserve0, reserve1, data);

                // Check the available liquidity increased
                expect(computedLiquidity).to.be.gt(prevComputedLiquidity);
            }
        });
    });
});

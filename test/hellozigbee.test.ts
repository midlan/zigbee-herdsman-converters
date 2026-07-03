import {describe, expect, test, vi} from "vitest";
import {Zcl} from "zigbee-herdsman";
import {findByDevice} from "../src";
import type {Zh} from "../src/lib/types";
import {mockDevice} from "./utils";

const jennicOptions = {manufacturerCode: Zcl.ManufacturerCode.NXP_SEMICONDUCTORS};

function e75Device(): Zh.Device {
    // common(1), left(2), right(3), both(4); switch endpoints expose genOnOff (in+out) and
    // genMultistateInput, mirroring the hellozigbee firmware.
    return mockDevice({
        modelID: "hello.zigbee.E75-2G4M10S",
        manufacturerName: "DIY",
        endpoints: [
            {ID: 1, inputClusters: ["genBasic", "genDeviceTempCfg"], outputClusters: []},
            {ID: 2, inputClusters: ["genOnOff", "genMultistateInput"], outputClusters: ["genOnOff", "genLevelCtrl", "genOnOffSwitchCfg"]},
            {ID: 3, inputClusters: ["genOnOff", "genMultistateInput"], outputClusters: ["genOnOff", "genLevelCtrl", "genOnOffSwitchCfg"]},
            {ID: 4, inputClusters: ["genOnOff", "genMultistateInput"], outputClusters: ["genOnOff", "genLevelCtrl", "genOnOffSwitchCfg"]},
        ],
    });
}

describe("Hello Zigbee", () => {
    test("decodes multistate button actions per endpoint", async () => {
        const device = e75Device();
        const definition = await findByDevice(device);
        const converters = definition.fromZigbee?.filter((c) => c.cluster === "genMultistateInput");
        expect(converters?.length).toBeGreaterThan(0);

        const decode = (endpointId: number, presentValue: number) => {
            for (const converter of converters ?? []) {
                const result = converter.convert(
                    definition,
                    {data: {presentValue}, endpoint: device.getEndpoint(endpointId), device} as never,
                    vi.fn(),
                    {},
                    {device} as never,
                );
                if (result) return result;
            }
        };

        expect(decode(2, 1)).toStrictEqual({action: "single_left"});
        expect(decode(3, 255)).toStrictEqual({action: "hold_right"});
        expect(decode(2, 2)).toStrictEqual({action: "double_left"});
        expect(decode(3, 3)).toStrictEqual({action: "triple_right"});
        expect(decode(4, 0)).toStrictEqual({action: "release_both"});
    });

    test("reads and writes switch_mode via the manufacturer-specific 0xFF00 attribute", async () => {
        const device = e75Device();
        const definition = await findByDevice(device);
        const leftEndpoint = device.getEndpoint(2);

        const tz = definition.toZigbee?.find((c) => c.key.includes("switch_mode"));
        expect(tz?.convertSet).toBeDefined();
        expect(tz?.convertGet).toBeDefined();

        // Set multifunction (index 2) on the left endpoint.
        await tz?.convertSet?.(leftEndpoint, "switch_mode", "multifunction", {
            device,
            endpoint_name: "left",
            mapped: definition,
            state: {},
        } as never);
        // The attribute is written by name; zigbee-herdsman resolves it to 0xFF00 + type via the custom cluster.
        expect(leftEndpoint.write).toHaveBeenCalledWith("genOnOffSwitchCfg", {switchMode: 2}, jennicOptions);

        await tz?.convertGet?.(leftEndpoint, "switch_mode", {device, endpoint_name: "left", mapped: definition} as never);
        expect(leftEndpoint.read).toHaveBeenCalledWith("genOnOffSwitchCfg", ["switchMode"], jennicOptions);

        // Report of switch_mode = momentary (index 1) is decoded for the left endpoint.
        const fz = definition.fromZigbee?.find(
            (c) =>
                c.cluster === "genOnOffSwitchCfg" &&
                c.convert(definition, {data: {switchMode: 1}, endpoint: leftEndpoint, device} as never, vi.fn(), {}, {device} as never)
                    ?.switch_mode_left !== undefined,
        );
        const decoded = fz?.convert(definition, {data: {switchMode: 1}, endpoint: leftEndpoint, device} as never, vi.fn(), {}, {device} as never);
        expect(decoded).toStrictEqual({switch_mode_left: "momentary"});
    });

    test("reads and writes switch_actions via the standard attribute (no manufacturer code)", async () => {
        const device = e75Device();
        const definition = await findByDevice(device);
        const leftEndpoint = device.getEndpoint(2);

        const tz = definition.toZigbee?.find((c) => c.key.includes("switch_actions"));
        expect(tz?.convertSet).toBeDefined();

        // Set toggle (index 2) - standard switchActions attribute, no manufacturer options.
        await tz?.convertSet?.(leftEndpoint, "switch_actions", "toggle", {
            device,
            endpoint_name: "left",
            mapped: definition,
            state: {},
        } as never);
        expect(leftEndpoint.write).toHaveBeenCalledWith("genOnOffSwitchCfg", {switchActions: 2}, undefined);

        await tz?.convertGet?.(leftEndpoint, "switch_actions", {device, endpoint_name: "left", mapped: definition} as never);
        expect(leftEndpoint.read).toHaveBeenCalledWith("genOnOffSwitchCfg", ["switchActions"], undefined);
    });
});

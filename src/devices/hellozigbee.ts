import {Zcl} from "zigbee-herdsman";
import * as m from "../lib/modernExtend";
import type {DefinitionWithExtend, ModernExtend} from "../lib/types";

// Manufacturer-specific attributes are extensions of the standard genOnOffSwitchCfg (0x0007)
// cluster, registered under the jennic/NXP manufacturer code.
const manufacturerCode = Zcl.ManufacturerCode.NXP_SEMICONDUCTORS;
const jennicOptions = {manufacturerCode};

const switchModeValues = ["toggle", "momentary", "multifunction"];
const switchActionValues = ["onOff", "offOn", "toggle"];
const relayModeValues = ["unlinked", "front", "single", "double", "triple", "long"];
const longPressModeValues = ["none", "levelCtrlUp", "levelCtrlDown"];
const operationModeValues = ["server", "client"];
const interlockModeValues = ["none", "mutualExclusion", "opposite"];

// Build a {name: index} lookup as expected by enumLookup.
function indexLookup(values: string[]): {[s: string]: number} {
    return Object.fromEntries(values.map((v, i) => [v, i]));
}

interface HelloZigbeeSwitchCfgCluster {
    attributes: {
        switchMode: number;
        relayMode: number;
        maxPause: number;
        minLongPress: number;
        longPressMode: number;
        operationMode: number;
        interlockMode: number;
    };
    commands: never;
    commandResponses: never;
}

// Adds the manufacturer-specific attributes on top of the standard genOnOffSwitchCfg cluster.
const addSwitchCfgCluster = m.deviceAddCustomCluster("genOnOffSwitchCfg", {
    ID: 0x0007,
    name: "genOnOffSwitchCfg",
    attributes: {
        switchMode: {name: "switchMode", ID: 0xff00, type: Zcl.DataType.ENUM8, manufacturerCode},
        relayMode: {name: "relayMode", ID: 0xff01, type: Zcl.DataType.ENUM8, manufacturerCode},
        maxPause: {name: "maxPause", ID: 0xff02, type: Zcl.DataType.UINT16, manufacturerCode},
        minLongPress: {name: "minLongPress", ID: 0xff03, type: Zcl.DataType.UINT16, manufacturerCode},
        longPressMode: {name: "longPressMode", ID: 0xff04, type: Zcl.DataType.ENUM8, manufacturerCode},
        operationMode: {name: "operationMode", ID: 0xff05, type: Zcl.DataType.ENUM8, manufacturerCode},
        interlockMode: {name: "interlockMode", ID: 0xff06, type: Zcl.DataType.ENUM8, manufacturerCode},
    },
    commands: {},
    commandsResponse: {},
});

// Config settings shared by every switch/button endpoint (single- and both-gang alike),
// except operation_mode and interlock_mode which are added per endpoint by the callers.
function commonSwitchSettings(endpointName: string): ModernExtend[] {
    return [
        m.enumLookup<"genOnOffSwitchCfg", HelloZigbeeSwitchCfgCluster>({
            name: "switch_mode",
            cluster: "genOnOffSwitchCfg",
            attribute: "switchMode",
            zigbeeCommandOptions: jennicOptions,
            endpointName,
            lookup: indexLookup(switchModeValues),
            description: "Switch mode: toggle reacts on each press, momentary follows the button, multifunction supports multi-clicks and hold",
            entityCategory: "config",
        }),
        // Standard switchActions attribute (0x0010), no manufacturer code.
        m.enumLookup({
            name: "switch_actions",
            cluster: "genOnOffSwitchCfg",
            attribute: "switchActions",
            endpointName,
            lookup: indexLookup(switchActionValues),
            description: "Direction of the physical switch action mapped to the on/off state",
            entityCategory: "config",
        }),
        m.enumLookup<"genOnOffSwitchCfg", HelloZigbeeSwitchCfgCluster>({
            name: "relay_mode",
            cluster: "genOnOffSwitchCfg",
            attribute: "relayMode",
            zigbeeCommandOptions: jennicOptions,
            endpointName,
            lookup: indexLookup(relayModeValues),
            description: "Defines on which button event the relay toggles (or stays decoupled when unlinked)",
            entityCategory: "config",
        }),
        m.enumLookup<"genOnOffSwitchCfg", HelloZigbeeSwitchCfgCluster>({
            name: "long_press_mode",
            cluster: "genOnOffSwitchCfg",
            attribute: "longPressMode",
            zigbeeCommandOptions: jennicOptions,
            endpointName,
            lookup: indexLookup(longPressModeValues),
            description: "Action generated on a long press: none, or level control up/down commands to bound devices",
            entityCategory: "config",
        }),
        m.numeric<"genOnOffSwitchCfg", HelloZigbeeSwitchCfgCluster>({
            name: "max_pause",
            cluster: "genOnOffSwitchCfg",
            attribute: "maxPause",
            zigbeeCommandOptions: jennicOptions,
            endpointNames: [endpointName],
            description: "Maximum time between consecutive clicks to be treated as a single multi-click action",
            unit: "ms",
            valueMin: 0,
            valueMax: 65535,
            entityCategory: "config",
        }),
        m.numeric<"genOnOffSwitchCfg", HelloZigbeeSwitchCfgCluster>({
            name: "min_long_press",
            cluster: "genOnOffSwitchCfg",
            attribute: "minLongPress",
            zigbeeCommandOptions: jennicOptions,
            endpointNames: [endpointName],
            description: "Minimum press duration to trigger a hold action",
            unit: "ms",
            valueMin: 0,
            valueMax: 65535,
            entityCategory: "config",
        }),
    ];
}

// A physical switch endpoint (left/right/button): relay + operation mode + common settings,
// optionally the interlock mode (only on the two-gang boards).
function switchEndpoint(endpointName: string, withInterlock: boolean): ModernExtend[] {
    const result: ModernExtend[] = [
        m.onOff({powerOnBehavior: false, endpointNames: [endpointName]}),
        m.enumLookup<"genOnOffSwitchCfg", HelloZigbeeSwitchCfgCluster>({
            name: "operation_mode",
            cluster: "genOnOffSwitchCfg",
            attribute: "operationMode",
            zigbeeCommandOptions: jennicOptions,
            endpointName,
            lookup: indexLookup(operationModeValues),
            description: "Server keeps internal state and reports it, client sends on/off/level commands to bound devices",
            entityCategory: "config",
        }),
        ...commonSwitchSettings(endpointName),
        // Client-mode commands emitted towards bound devices, exposed as actions.
        m.commandsOnOff({endpointNames: [endpointName]}),
        m.commandsLevelCtrl({endpointNames: [endpointName]}),
    ];

    if (withInterlock) {
        result.push(
            m.enumLookup<"genOnOffSwitchCfg", HelloZigbeeSwitchCfgCluster>({
                name: "interlock_mode",
                cluster: "genOnOffSwitchCfg",
                attribute: "interlockMode",
                zigbeeCommandOptions: jennicOptions,
                endpointName,
                lookup: indexLookup(interlockModeValues),
                description: "Interlock behaviour between the two gangs: none, mutual exclusion, or always opposite",
                entityCategory: "config",
            }),
        );
    }

    return result;
}

// The virtual "both" endpoint (two-gang boards) has settings only, no relay/operation/interlock.
function bothButtonsEndpoint(endpointName: string): ModernExtend[] {
    return commonSwitchSettings(endpointName);
}

// Multistate button actions ({0:release,1:single,2:double,3:triple,255:hold}) postfixed per endpoint.
function switchActions(endpointNames: string[]): ModernExtend {
    return m.actionEnumLookup({
        cluster: "genMultistateInput",
        attribute: "presentValue",
        actionLookup: {release: 0, single: 1, double: 2, triple: 3, hold: 255},
        endpointNames,
    });
}

// Reads the switch configuration attributes on join so the dashboard reflects the device state.
async function configureReadSwitchCfg(device: Parameters<NonNullable<DefinitionWithExtend["configure"]>>[0]): Promise<void> {
    for (const ep of device.endpoints) {
        if (ep.supportsOutputCluster("genOnOff")) {
            await ep.read("genOnOffSwitchCfg", ["switchActions"]);
            await ep.read<"genOnOffSwitchCfg", HelloZigbeeSwitchCfgCluster>(
                "genOnOffSwitchCfg",
                ["switchMode", "relayMode", "maxPause", "minLongPress", "longPressMode", "operationMode", "interlockMode"],
                jennicOptions,
            );
        }
    }
}

export const definitions: DefinitionWithExtend[] = [
    {
        zigbeeModel: ["hello.zigbee.E75-2G4M10S"],
        model: "E75-2G4M10S",
        vendor: "DIY",
        description: "Hello Zigbee switch based on the E75-2G4M10S module",
        extend: [
            m.deviceEndpoints({endpoints: {common: 1, left: 2, right: 3, both: 4}}),
            addSwitchCfgCluster,
            ...switchEndpoint("left", true),
            ...switchEndpoint("right", true),
            ...bothButtonsEndpoint("both"),
            switchActions(["left", "right", "both"]),
            m.deviceTemperature({reporting: false}),
        ],
        configure: configureReadSwitchCfg,
        ota: true,
    },
    {
        zigbeeModel: ["hello.zigbee.QBKG11LM"],
        model: "Hello Zigbee QBKG11LM",
        vendor: "DIY",
        description: "Hello Zigbee switch firmware for Aqara QBKG11LM",
        extend: [
            m.deviceEndpoints({endpoints: {common: 1, button: 2}}),
            addSwitchCfgCluster,
            ...switchEndpoint("button", false),
            switchActions(["button"]),
            m.deviceTemperature({reporting: false}),
            // On-board HLW8012 metering: calibrated W / 0.1 V / mA on the common
            // endpoint ElectricalMeasurement cluster, lifetime kWh via seMetering
            m.electricityMeter(),
        ],
        configure: configureReadSwitchCfg,
        ota: true,
    },
    {
        zigbeeModel: ["hello.zigbee.QBKG12LM"],
        model: "Hello Zigbee QBKG12LM",
        vendor: "DIY",
        description: "Hello Zigbee switch firmware for Aqara QBKG12LM",
        extend: [
            m.deviceEndpoints({endpoints: {common: 1, left: 2, right: 3, both: 4}}),
            addSwitchCfgCluster,
            ...switchEndpoint("left", true),
            ...switchEndpoint("right", true),
            ...bothButtonsEndpoint("both"),
            switchActions(["left", "right", "both"]),
            m.deviceTemperature({reporting: false}),
        ],
        configure: configureReadSwitchCfg,
        ota: true,
    },
];

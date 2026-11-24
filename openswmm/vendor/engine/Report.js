/**
 * @file Report.ts
 * @brief Report records (Python `openswmm.engine._report`).
 *
 * @license  Apache-2.0
 */
import { LinkType, NodeType, RoutingTotal, RunoffTotal } from "./enums.js";
/**
 * Collect the report's main results from an ended run (Python
 * `get_report_snapshot`): continuity, routing diagnostics and the node, link,
 * pump and subcatchment summaries, read from the mass balance and statistics.
 */
export function getReportSnapshot(solver) {
    const mb = solver.massBalance;
    const st = solver.statistics;
    const simSeconds = Math.max((solver.endDatetime.getTime() - solver.startDatetime.getTime()) / 1000, 1);
    const ro = (c) => mb.runoffTotal(c);
    const rt = (c) => mb.routingTotal(c);
    const runoffContinuity = {
        continuityErrorPct: 100 * mb.runoffContinuityError,
        totalRainfall: ro(RunoffTotal.RAINFALL),
        totalEvaporation: ro(RunoffTotal.EVAP),
        totalInfiltration: ro(RunoffTotal.INFIL),
        totalRunoff: ro(RunoffTotal.RUNOFF),
        totalSnowRemoval: ro(RunoffTotal.SNOWREMOV),
        initialStorage: ro(RunoffTotal.INITSTORE),
        finalStorage: ro(RunoffTotal.FINALSTORE),
        initialSnow: ro(RunoffTotal.INITSNOW),
        finalSnow: ro(RunoffTotal.FINALSNOW),
    };
    const routingContinuity = {
        continuityErrorPct: 100 * mb.routingContinuityError,
        dryWeatherInflow: rt(RoutingTotal.DRY_WEATHER),
        wetWeatherInflow: rt(RoutingTotal.WET_WEATHER),
        groundwaterInflow: rt(RoutingTotal.GW_INFLOW),
        rdiiInflow: rt(RoutingTotal.RDII),
        externalInflow: rt(RoutingTotal.EXTERNAL),
        totalFlooding: rt(RoutingTotal.FLOODING),
        totalOutflow: rt(RoutingTotal.OUTFLOW),
        evaporationLoss: rt(RoutingTotal.EVAP_LOSS),
        seepageLoss: rt(RoutingTotal.SEEP_LOSS),
        initialStorage: rt(RoutingTotal.INIT_STORAGE),
        finalStorage: rt(RoutingTotal.FINAL_STORAGE),
        forcingInflow: rt(RoutingTotal.FORCING_INFLOW),
        couplingOutflow: rt(RoutingTotal.COUPLING_OUT),
        linkGroundwaterInflow: rt(RoutingTotal.LINK_GW_INFLOW),
    };
    const orZero = (f) => {
        try {
            return f();
        }
        catch {
            return 0;
        }
    };
    const qualityContinuity = Array.from({ length: solver.pollutants.length }, (_, i) => ({
        pollutantId: solver.pollutants.getId(i),
        continuityErrorPct: 100 * mb.qualityContinuityError(i),
        seepLoss: orZero(() => mb.qualitySeepLoss(i)),
        evapLoss: orZero(() => mb.qualityEvapLoss(i)),
    }));
    const typeName = (names, v) => names[v] ?? `TYPE_${v}`;
    const [depth, overflow, volFlooded, timeFlooded] = [
        st.nodeMaxDepth,
        st.nodeMaxOverflow,
        st.nodeVolFlooded,
        st.nodeTimeFlooded,
    ];
    const nodeFlooding = [];
    const storageSummary = [];
    for (let i = 0; i < solver.nodes.length; i++) {
        const type = solver.nodes.get(i).type;
        const entry = {
            nodeId: solver.nodes.getId(i),
            nodeType: typeName(NodeType, type),
            maxDepth: depth[i],
            maxOverflowRate: overflow[i],
            totalFloodVolume: volFlooded[i],
            timeFlooded: timeFlooded[i],
        };
        if (entry.totalFloodVolume > 0)
            nodeFlooding.push(entry);
        if (type === NodeType.STORAGE)
            storageSummary.push(entry);
    }
    nodeFlooding.sort((a, b) => b.totalFloodVolume - a.totalFloodVolume);
    const [flow, velocity, filling, volFlow, surcharge] = [
        st.linkMaxFlow,
        st.linkMaxVelocity,
        st.linkMaxFilling,
        st.linkVolFlow,
        st.linkSurchargeTime,
    ];
    const linkFlowSummary = [];
    const pumpSummary = [];
    for (let i = 0; i < solver.links.length; i++) {
        const link = solver.links.get(i);
        const type = link.type;
        linkFlowSummary.push({
            linkId: solver.links.getId(i),
            linkType: typeName(LinkType, type),
            maxFlow: flow[i],
            maxVelocity: velocity[i],
            maxFilling: filling[i],
            totalVolume: volFlow[i],
            surchargeTime: surcharge[i],
        });
        if (type === LinkType.PUMP) {
            const onTime = link.stats.pumpOnTime;
            pumpSummary.push({
                linkId: solver.links.getId(i),
                pumpCurveIdx: link.pump.curve,
                numStartups: link.stats.pumpCycles,
                totalOnTime: onTime,
                totalVolume: link.stats.pumpVolume,
                pctTimeOn: Math.min((onTime / simSeconds) * 100, 100),
            });
        }
    }
    linkFlowSummary.sort((a, b) => b.maxFlow - a.maxFlow);
    const [runoffVol, maxRunoff] = [st.subcatchmentRunoffVol, st.subcatchmentMaxRunoff];
    const subcatchmentSummary = Array.from({ length: solver.subcatchments.length }, (_, i) => {
        const precip = solver.subcatchments.get(i).stats.precip;
        return {
            subcatchId: solver.subcatchments.getId(i),
            totalPrecip: precip,
            totalRunoffVol: runoffVol[i],
            maxRunoffRate: maxRunoff[i],
            runoffCoefficient: precip > 0 ? runoffVol[i] / precip : 0,
        };
    });
    return {
        routingDiagnostics: mb.routingDiagnostics,
        runoffContinuity,
        routingContinuity,
        qualityContinuity,
        nodeFlooding,
        storageSummary,
        linkFlowSummary,
        pumpSummary,
        subcatchmentSummary,
    };
}
//# sourceMappingURL=Report.js.map
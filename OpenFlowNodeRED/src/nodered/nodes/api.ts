import { Red } from "node-red";
import * as api from "./api_nodes";

export = function (RED: Red) {
    RED.nodes.registerType("api-credentials", api.api_credentials, {
        credentials: {
            username: { type: "text" },
            password: { type: "password" }
        }
    });
    RED.nodes.registerType("api get jwt", api.api_get_jwt);
    RED.nodes.registerType("api get", api.api_get);
    RED.nodes.registerType("api add", api.api_add);
    RED.nodes.registerType("api add many", api.api_addmany);
    RED.nodes.registerType("api update", api.api_update);
    RED.nodes.registerType("api addorupdate", api.api_addorupdate);
    RED.nodes.registerType("api delete", api.api_delete);
    RED.nodes.registerType("api delete many", api.api_deletemany);


    RED.nodes.registerType("map reduce", api.api_map_reduce);
    RED.nodes.registerType("api updatedocument", api.api_updatedocument);
    RED.nodes.registerType("api aggregate", api.api_aggregate);
    RED.nodes.registerType("api watch", api.api_watch);

    RED.nodes.registerType("grant permission", api.grant_permission);
    RED.nodes.registerType("revoke permission", api.revoke_permission);

    RED.nodes.registerType("api download file", api.download_file);
    RED.nodes.registerType("api upload file", api.upload_file);

    RED.nodes.registerType("api list collections", api.list_collections);
    RED.nodes.registerType("api drop collection", api.drop_collection);

    RED.nodes.registerType("api housekeeping", api.housekeeping);

    RED.httpAdmin.get("/api_roles", RED.auth.needsPermission('serial.read'), api.get_api_roles);
    RED.httpAdmin.get("/api_userroles", RED.auth.needsPermission('serial.read'), api.get_api_userroles);
    RED.httpAdmin.get("/api_users", RED.auth.needsPermission('serial.read'), api.get_api_users);

}

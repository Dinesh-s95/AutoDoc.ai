package com.vm.usermanagement.client;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import java.util.Map;

@FeignClient(name = "identityprovider", url = "http://localhost:8081/idp/users")
public interface IdentityProviderClient {
    @PostMapping("/idp/users/login")
    Map<String, Object> login(@RequestBody Map<String, String> credentials);
}

package com.vm.enrollment.client;

import com.vm.enrollment.dto.UserResponseDTO;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;

@FeignClient(name = "usermanagement", url = "http://localhost:8083/user-management")
public interface UserManagementClient {
    @GetMapping("/get-user")
    UserResponseDTO getUser(@RequestParam String username);
}
